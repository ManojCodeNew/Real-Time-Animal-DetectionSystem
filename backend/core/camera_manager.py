import cv2
import numpy as np
import threading
import time
import os
import sys
from datetime import datetime, timedelta
from database.database import SessionLocal
from database import crud, models
from core.forecasting_engine import recalculate
from ultralytics import YOLO

# Mappings of COCO categories to our target 4 agricultural threat species (for visualization & backward compatibility)
COCO_MAP = {
    "elephant": "elephant",
    "cow": "nilgai",
    "horse": "nilgai",
    "sheep": "wild_boar",
    "dog": "wild_boar",
    "cat": "macaque",
    "bird": "macaque",
    "zebra": "nilgai",
    "giraffe": "nilgai",
    "bear": "elephant",
    "person": "macaque"
}

class CameraStreamManager:
    _instance = None
    _lock = threading.Lock()

    @classmethod
    def get_instance(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(self):
        self.cap = None
        self.thread = None
        self.active = False
        self.latest_frame = None
        self.model = None
        self.active_tracks = {}
        self.tau_timeout = 3.0
        self.test_simulate = False
        
        # Redesigned State Machine variables
        self.state = "idle"  # "idle", "validating_camera", "loading_model", "initializing_tracker", "opening_camera", "running", "failed"
        self.phase = "Ready"
        self.error_message = None
        self.camera_index = -1
        self.active_tracks_count = 0

    def list_cameras(self):
        """Scans for available video capture devices (indexes 0 to 5) and returns them."""
        available_cameras = []
        # Always include the simulated mock source
        available_cameras.append({"id": -1, "name": "Simulated Camera (Mock)"})
        
        # Test indexes 0-5
        for index in range(6):
            try:
                # Use a short timeout/open test
                cap = cv2.VideoCapture(index)
                if cap is not None and cap.isOpened():
                    ret, _ = cap.read()
                    if ret:
                        available_cameras.append({
                            "id": index,
                            "name": f"Physical Camera Device #{index}"
                        })
                    cap.release()
            except Exception:
                pass
        return available_cameras

    def start(self, camera_index=0):
        with self._lock:
            # If already running or starting, do nothing
            if self.active and self.state in ["running", "validating_camera", "loading_model", "initializing_tracker", "opening_camera"]:
                return True
            
            print(f"[CAMERA MANAGER] Initiating startup on camera index {camera_index}...")
            self.active = True
            self.state = "validating_camera"
            self.phase = "Checking Camera..."
            self.error_message = None
            self.camera_index = camera_index
            self.active_tracks = {}
            self.active_tracks_count = 0
            
            # Run setup and processing in a background thread to keep Flask API responsive
            self.thread = threading.Thread(target=self._run_loop, daemon=True)
            self.thread.start()
            return True
            
    def stop(self):
        with self._lock:
            if not self.active:
                return
            print("[CAMERA MANAGER] Deactivation request received.")
            self.active = False
            
    def get_status(self):
        """Returns the full dictionary of telemetry and diagnostics status."""
        return {
            "active": self.active,
            "state": self.state,
            "phase": self.phase,
            "camera_index": self.camera_index,
            "active_tracks_count": self.active_tracks_count,
            "error": self.error_message
        }

    def _run_loop(self):
        db = SessionLocal()
        from edge_pipeline import GAMMA_LUT, CLAHE_LOW, CLAHE_HIGH, compute_brightness, preprocess_frame
        
        window_title = "FarmGuard AI Boundary Monitor"
        frame_idx = 0
        
        try:
            # Step 1: Validate Camera
            if self.camera_index >= 0:
                print(f"[CAMERA MANAGER] Phase 1: Validating camera {self.camera_index}")
                self.state = "validating_camera"
                self.phase = "Checking Camera..."
                temp_cap = cv2.VideoCapture(self.camera_index)
                if temp_cap is None or not temp_cap.isOpened():
                    self.state = "failed"
                    self.error_message = f"Camera device #{self.camera_index} is busy, disconnected, or locked by another app."
                    self.active = False
                    return
                temp_cap.release()
            
            # Step 2: Load YOLOv8 Model
            print("[CAMERA MANAGER] Phase 2: Loading YOLOv8 Model...")
            self.state = "loading_model"
            self.phase = "Loading YOLO Model..."
            if self.model is None:
                try:
                    self.model = YOLO("yolov8n.pt")
                except Exception as e:
                    self.state = "failed"
                    self.error_message = f"YOLO weights file could not be initialized: {str(e)}"
                    self.active = False
                    return
            
            # Step 3: Initialize Tracker
            print("[CAMERA MANAGER] Phase 3: Initializing Tracker...")
            self.state = "initializing_tracker"
            self.phase = "Preparing Tracker..."
            time.sleep(0.5)  # Yield for visual progress state
            
            # Step 4: Open Camera Capture Source
            print(f"[CAMERA MANAGER] Phase 4: Opening camera source {self.camera_index}...")
            self.state = "opening_camera"
            self.phase = "Opening Camera..."
            if self.camera_index == -1:
                from edge_pipeline import MockVideoCapture
                self.cap = MockVideoCapture(max_frames=100000)
                self.test_simulate = True
            else:
                self.cap = cv2.VideoCapture(self.camera_index)
                self.test_simulate = False
                if not self.cap.isOpened():
                    self.state = "failed"
                    self.error_message = f"Failed to open video capture handle on camera #{self.camera_index}"
                    self.active = False
                    return

            # Step 5: Start Detection Stream
            print("[CAMERA MANAGER] Phase 5: Detection module running.")
            self.state = "running"
            self.phase = "Detection active"
            
            # Create the OpenCV Native window
            cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
            
            while self.active and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret or frame is None:
                    break
                    
                current_time = datetime.now()
                frame_idx += 1
                
                # 1. Image Preprocessing (Gamma & CLAHE)
                brightness = compute_brightness(frame)
                enhanced, b_path = preprocess_frame(frame, brightness)
                
                # 2. Dynamic Confidence Threshold
                conf_thresh = 0.35 if brightness < 60 else 0.50
                
                # 3. Model-Independent Tracking: run tracker on ALL classes in the model
                # We omit the 'classes' keyword argument to track every class dynamically
                results = self.model.track(enhanced, persist=True, conf=conf_thresh, verbose=False)
                
                detected_ids = set()
                annotated_frame = enhanced.copy()
                
                if results and len(results) > 0:
                    boxes = results[0].boxes
                    if boxes is not None and boxes.id is not None:
                        for box in boxes:
                            track_id = int(box.id[0])
                            conf = float(box.conf[0])
                            cls_id = int(box.cls[0])
                            
                            # Fetch species name from model dictionary (model-independent)
                            raw_name = self.model.names[cls_id]
                            # Map if matches COCO animals, otherwise use model class name directly
                            species = COCO_MAP.get(raw_name, raw_name)
                            
                            detected_ids.add(track_id)
                            
                            # Draw native window bounding boxes
                            xyxy = box.xyxy[0].cpu().numpy().astype(int)
                            cv2.rectangle(annotated_frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (0, 0, 255), 2)
                            cv2.putText(
                                annotated_frame, 
                                f"Track #{track_id}: {species.replace('_', ' ').capitalize()} ({conf * 100:.1f}%)", 
                                (xyxy[0], xyxy[1] - 10), 
                                cv2.FONT_HERSHEY_SIMPLEX, 
                                0.55, 
                                (0, 255, 0), 
                                2
                            )
                            
                            # Tracking logic
                            if track_id not in self.active_tracks:
                                print(f"[CAMERA ENTRY] Track {track_id}: {species} detected.")
                                self.active_tracks[track_id] = {
                                    "species": species,
                                    "entry_time": current_time,
                                    "last_seen": current_time,
                                    "confidences": [conf],
                                    "brightnesses": [brightness],
                                    "brightness_paths": [b_path]
                                }
                                
                                # Send immediate alerts (Phase 5 email logger)
                                try:
                                    from core.notifications import log_detection_alert
                                    log_detection_alert(species, track_id, current_time, brightness, conf)
                                except Exception as e:
                                    print(f"Warning: could not send email alert: {e}")
                            else:
                                track = self.active_tracks[track_id]
                                track["last_seen"] = current_time
                                track["confidences"].append(conf)
                                track["brightnesses"].append(brightness)
                                track["brightness_paths"].append(b_path)
                
                self.active_tracks_count = len(self.active_tracks)
                
                # Check for lost tracks (timeouts)
                timed_out_ids = []
                for tid, track in list(self.active_tracks.items()):
                    if tid not in detected_ids and (current_time - track["last_seen"]).total_seconds() > self.tau_timeout:
                        timed_out_ids.append(tid)
                        
                for tid in timed_out_ids:
                    track = self.active_tracks.pop(tid)
                    mean_conf = float(np.mean(track["confidences"]))
                    mean_brightness = float(np.mean(track["brightnesses"]))
                    
                    from collections import Counter
                    b_path_mode = Counter(track["brightness_paths"]).most_common(1)[0][0]
                    
                    print(f"[CAMERA EXIT] Track {tid}: {track['species']} left. Duration: {(track['last_seen'] - track['entry_time']).total_seconds():.1f}s. Logging to DB...")
                    
                    # Transactional Database write
                    crud.log_intrusion(
                        db=db,
                        species_name=track["species"],
                        tracker_id=tid,
                        entry_time=track["entry_time"],
                        exit_time=track["last_seen"],
                        confidence=mean_conf,
                        weather="Simulated_Live" if self.test_simulate else "Live_Camera",
                        source="live",
                        confirmed=None,
                        status="active",
                        brightness=round(mean_brightness, 2),
                        brightness_path=b_path_mode
                    )
                    
                    # Recalculate predictions
                    try:
                        recalculate(track["species"], db)
                    except Exception as e:
                        print(f"Warning: could not recalculate forecast: {e}")
                
                # Render to the native OpenCV window
                cv2.imshow(window_title, annotated_frame)
                
                # Handle window events and keypresses
                key = cv2.waitKey(1) & 0xFF
                if key == 27 or key == ord('q'):  # Escape or 'q' key
                    print("[CAMERA MANAGER] Termination triggered by keyboard input.")
                    self.active = False
                    break
                    
                # Handle manual window close button [X] (skip first 30 frames to allow window warming up)
                if frame_idx > 30:
                    try:
                        if cv2.getWindowProperty(window_title, cv2.WND_PROP_VISIBLE) < 1:
                            print("[CAMERA MANAGER] Native window was closed by the user.")
                            self.active = False
                            break
                    except Exception:
                        pass
                
                time.sleep(0.03)  # Loop delay (~30 FPS)
                
        except Exception as e:
            print(f"[CAMERA MANAGER] Thread exception encountered: {e}")
            self.state = "failed"
            self.error_message = f"Inference engine crashed: {str(e)}"
            self.active = False
        finally:
            db.close()
            # Safety clean up
            try:
                cv2.destroyAllWindows()
            except Exception:
                pass
            if self.cap:
                try:
                    self.cap.release()
                except Exception:
                    pass
            self.cap = None
            self.active_tracks_count = 0
            
            # Reset state unless we are in a failure condition
            if self.state != "failed":
                self.state = "idle"
                self.phase = "Ready"
                self.active = False
            print("[CAMERA MANAGER] Native camera thread exited cleanly.")
