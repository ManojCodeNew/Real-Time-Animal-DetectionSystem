import cv2
import numpy as np
import os
import sys
import time
import argparse
from datetime import datetime, timedelta

# Add parent directory to path so we can import database modules
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(script_dir)

from database.database import SessionLocal, init_db
from database import crud

# Precompute Gamma correction lookup table for gamma = 0.5
def get_gamma_lut(gamma=0.5):
    invGamma = 1.0 / gamma
    table = np.array([((i / 255.0) ** invGamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
    return table

# Setup Gamma table and reused CLAHE objects globally
GAMMA_LUT = get_gamma_lut(0.5)
CLAHE_LOW = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
CLAHE_HIGH = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))

def compute_brightness(frame):
    """Compute the average brightness of the frame."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray))

def preprocess_frame(frame, brightness):
    """Enhance frame based on current average brightness."""
    if brightness < 50:
        # Low-Light Path: Apply Gamma correction first (via LUT lookup)
        gamma_corrected = cv2.LUT(frame, GAMMA_LUT)
        # Convert to CIELAB and apply CLAHE to L-channel
        lab = cv2.cvtColor(gamma_corrected, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        cl = CLAHE_LOW.apply(l)
        limg = cv2.merge((cl, a, b))
        enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        return enhanced, "low_light"
    else:
        # Daylight / Fog Path: Apply CLAHE directly to CIELAB L-channel
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        cl = CLAHE_HIGH.apply(l)
        limg = cv2.merge((cl, a, b))
        enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        return enhanced, "daylight"

class MockVideoCapture:
    """Mock Video Capture that generates simulated video frames for headless testing."""
    def __init__(self, width=640, height=480, max_frames=60):
        self.width = width
        self.height = height
        self.max_frames = max_frames
        self.frame_count = 0
        
    def isOpened(self):
        return self.frame_count < self.max_frames
        
    def read(self):
        if self.frame_count >= self.max_frames:
            return False, None
            
        # Simulate night/day transition
        # First half of frames: Night (dark grey background)
        # Second half: Day (light grey background)
        bg = 20 if self.frame_count < 30 else 150
        frame = np.ones((self.height, self.width, 3), dtype=np.uint8) * bg
        
        # Draw a moving rectangle representing a simulated object
        rect_color = (0, 255, 0)
        x1 = 100 + (self.frame_count * 5)
        y1 = 150
        cv2.rectangle(frame, (x1, y1), (x1 + 60, y1 + 60), rect_color, -1)
        
        self.frame_count += 1
        return True, frame
        
    def release(self):
        pass

def run_pipeline(video_path=None, test_simulate=False):
    # Initialize DB session
    db = SessionLocal()
    
    # Initialize YOLO Model
    print("Loading YOLOv8n model...")
    from ultralytics import YOLO
    model = YOLO("yolov8n.pt")
    
    # Open Video Source
    if test_simulate:
        print("Starting simulated/mock video source...")
        cap = MockVideoCapture()
    elif video_path:
        print(f"Opening video file: {video_path}")
        cap = cv2.VideoCapture(video_path)
    else:
        print("Opening camera stream...")
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("Warning: Camera source could not be opened. Falling back to Mock Video Source.")
            cap = MockVideoCapture()
            test_simulate = True

    # Active tracks state tracker:
    # { tracker_id: {
    #      "species": name,
    #      "entry_time": datetime,
    #      "last_seen": datetime,
    #      "confidences": [float],
    #      "brightnesses": [float],
    #      "brightness_paths": [str]
    # } }
    active_tracks = {}
    tau_timeout = 3.0 # Seconds before closing track
    
    print("\n--- Pipeline Active ---")
    frame_idx = 0
    
    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret or frame is None:
                break
                
            current_time = datetime.now()
            
            # 1. Compute brightness and Preprocess
            brightness = compute_brightness(frame)
            enhanced_frame, b_path = preprocess_frame(frame, brightness)
            
            # 2. Dynamic thresholding based on average brightness
            conf_thresh = 0.35 if brightness < 60 else 0.50
            
            # 3. Track objects in frame (classes matching COCO index for animals and person)
            # COCO Indices: 14 (bird), 15 (cat), 16 (dog), 17 (horse), 18 (sheep), 19 (cow), 20 (elephant), 21 (bear), 22 (zebra), 23 (giraffe), 0 (person)
            target_classes = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0]
            
            # Run YOLO detector with tracking enabled
            results = model.track(enhanced_frame, persist=True, conf=conf_thresh, classes=target_classes, verbose=False)
            
            detected_ids = set()
            
            for r in results:
                boxes = r.boxes
                if boxes is None or boxes.id is None:
                    continue
                    
                for box in boxes:
                    track_id = int(box.id[0])
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    species = model.names[cls_id]
                    
                    detected_ids.add(track_id)
                    
                    if track_id not in active_tracks:
                        # Event entry detected!
                        print(f"[ENTRY] Track {track_id}: {species} detected. Path: {b_path}, Brightness: {brightness:.1f}")
                        active_tracks[track_id] = {
                            "species": species,
                            "entry_time": current_time,
                            "last_seen": current_time,
                            "confidences": [conf],
                            "brightnesses": [brightness],
                            "brightness_paths": [b_path]
                        }
                    else:
                        # Update active track statistics
                        track = active_tracks[track_id]
                        track["last_seen"] = current_time
                        track["confidences"].append(conf)
                        track["brightnesses"].append(brightness)
                        track["brightness_paths"].append(b_path)
            
            # If in test/simulate mode and we have no real detections, we can inject a mock detection
            # to make sure database logging runs and closes successfully in headless environments
            if test_simulate and frame_idx == 5:
                # Inject a simulated elephant detection
                mock_id = 999
                print(f"[ENTRY] Track {mock_id}: elephant detected (Simulated Injection). Path: {b_path}, Brightness: {brightness:.1f}")
                active_tracks[mock_id] = {
                    "species": "elephant",
                    "entry_time": current_time - timedelta(seconds=10), # started 10s ago
                    "last_seen": current_time,
                    "confidences": [0.85],
                    "brightnesses": [brightness],
                    "brightness_paths": [b_path]
                }
            elif test_simulate and frame_idx > 5 and 999 in active_tracks:
                # Keep active until frame 20, then stop updating so it times out and closes
                if frame_idx <= 20:
                    active_tracks[999]["last_seen"] = current_time
                    active_tracks[999]["confidences"].append(0.85)
                    active_tracks[999]["brightnesses"].append(brightness)
                    active_tracks[999]["brightness_paths"].append(b_path)
                    
            # 4. Check for lost tracks and log them to SQLite on track close (exit)
            lost_track_ids = []
            for tid, track in active_tracks.items():
                # If track hasn't been seen for more than tau_timeout, close the session
                time_since_seen = (current_time - track["last_seen"]).total_seconds()
                if time_since_seen > tau_timeout:
                    lost_track_ids.append(tid)
                    
            for tid in lost_track_ids:
                track = active_tracks.pop(tid)
                mean_conf = float(np.mean(track["confidences"]))
                mean_brightness = float(np.mean(track["brightnesses"]))
                # Most common brightness path
                from collections import Counter
                b_path_mode = Counter(track["brightness_paths"]).most_common(1)[0][0]
                
                print(f"[EXIT] Track {tid}: {track['species']} left. Duration: {(track['last_seen'] - track['entry_time']).total_seconds():.1f}s. Logging to DB...")
                
                # Write to SQLite database
                crud.log_intrusion(
                    db=db,
                    species_name=track["species"],
                    tracker_id=tid,
                    entry_time=track["entry_time"],
                    exit_time=track["last_seen"],
                    confidence=mean_conf,
                    weather="Simulated_Live",
                    source="live",
                    confirmed=None,
                    status="active",
                    brightness=round(mean_brightness, 2),
                    brightness_path=b_path_mode
                )
            
            frame_idx += 1
            # Control frame rate slightly for simulated run
            if test_simulate:
                time.sleep(0.03) # ~30 FPS simulation
                
    except KeyboardInterrupt:
        print("\nPipeline interrupted by user.")
    finally:
        cap.release()
        db.close()
        print("Pipeline release clean.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Edge Vision Pipeline for Wildlife Intrusion Detection")
    parser.add_argument("--video", type=str, help="Path to video file (optional)")
    parser.add_argument("--simulate", action="store_true", help="Run in mock/simulate mode for testing")
    args = parser.parse_args()
    
    run_pipeline(video_path=args.video, test_simulate=args.simulate)
