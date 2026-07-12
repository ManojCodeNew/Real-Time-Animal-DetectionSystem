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

# Mappings of COCO categories to our target 4 agricultural threat species
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
        
    def start(self):
        with self._lock:
            if self.active:
                return True
            
            print("[CAMERA MANAGER] Starting video stream & pipeline...")
            # Load YOLO if not already loaded
            if self.model is None:
                print("[CAMERA MANAGER] Loading YOLOv8n model...")
                self.model = YOLO("yolov8n.pt")
                
            # Attempt to open real camera, fallback to Mock
            self.cap = cv2.VideoCapture(0)
            self.test_simulate = False
            if not self.cap.isOpened():
                print("[CAMERA MANAGER] Physical camera not found. Initializing MockVideoCapture...")
                from edge_pipeline import MockVideoCapture
                # Set a very high frame count to stream indefinitely
                self.cap = MockVideoCapture(max_frames=100000)
                self.test_simulate = True
                
            self.active = True
            self.active_tracks = {}
            self.thread = threading.Thread(target=self._run_loop, daemon=True)
            self.thread.start()
            return True
            
    def stop(self):
        with self._lock:
            if not self.active:
                return
            print("[CAMERA MANAGER] Stopping video stream & pipeline...")
            self.active = False
            if self.thread:
                self.thread.join(timeout=1.0)
            if self.cap:
                self.cap.release()
            self.cap = None
            self.latest_frame = None
            
    def get_status(self):
        return self.active

    def _run_loop(self):
        db = SessionLocal()
        from edge_pipeline import GAMMA_LUT, CLAHE_LOW, CLAHE_HIGH, compute_brightness, preprocess_frame
        
        frame_idx = 0
        try:
            while self.active and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret or frame is None:
                    break
                    
                current_time = datetime.now()
                frame_idx += 1
                
                # 1. Preprocess using Gamma + CLAHE (Gaps 2)
                brightness = compute_brightness(frame)
                enhanced, b_path = preprocess_frame(frame, brightness)
                
                # 2. Dynamic thresholding
                conf_thresh = 0.35 if brightness < 60 else 0.50
                
                # 3. Track target COCO objects (animals + person) using ByteTrack (Gap 3)
                target_classes = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0]
                results = self.model.track(enhanced, persist=True, conf=conf_thresh, classes=target_classes, verbose=False)
                
                detected_ids = set()
                annotated_frame = enhanced.copy()
                
                # Draw bounding boxes and map predictions
                if results and len(results) > 0:
                    boxes = results[0].boxes
                    if boxes is not None and boxes.id is not None:
                        for box in boxes:
                            track_id = int(box.id[0])
                            conf = float(box.conf[0])
                            cls_id = int(box.cls[0])
                            coco_name = self.model.names[cls_id]
                            
                            # Map COCO label to target farm threat
                            species = COCO_MAP.get(coco_name, coco_name)
                            
                            detected_ids.add(track_id)
                            
                            # Visual box annotations for the live feed
                            xyxy = box.xyxy[0].cpu().numpy().astype(int)
                            cv2.rectangle(annotated_frame, (xyxy[0], xyxy[1]), (xyxy[2], xyxy[3]), (0, 255, 0), 2)
                            cv2.putText(
                                annotated_frame, 
                                f"Track #{track_id}: {species.replace('_', ' ').capitalize()} ({conf * 100:.1f}%)", 
                                (xyxy[0], xyxy[1] - 10), 
                                cv2.FONT_HERSHEY_SIMPLEX, 
                                0.55, 
                                (36, 255, 12), 
                                2
                            )
                            
                            # ByteTrack prevents duplicate entry logs (Gap 3)
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
                                
                                # Send immediate alerts (Phase 5 notifications)
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
                                
                # Handle inactive tracking tracks (timeouts)
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
                    
                    # Log intrusion metadata (Zero image storage decision)
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
                    
                    # Recalculate forecast profiles inline (Gap 1)
                    try:
                        recalculate(track["species"], db)
                    except Exception as e:
                        print(f"Warning: could not recalculate forecast: {e}")
                        
                # Encode the annotated frame to JPEG for streaming
                ret, jpeg = cv2.imencode('.jpg', annotated_frame)
                if ret:
                    self.latest_frame = jpeg.tobytes()
                    
                # Frame rate throttling (~30 FPS capability matching 30.2 FPS claim)
                time.sleep(0.03)
        except Exception as e:
            print(f"[CAMERA MANAGER] Thread run loop encountered exception: {e}")
        finally:
            db.close()
            print("[CAMERA MANAGER] Thread release clean.")
            
    def get_frame(self):
        """Returns the latest annotated JPEG frame bytes."""
        return self.latest_frame
