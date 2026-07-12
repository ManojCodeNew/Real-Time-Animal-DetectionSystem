import cv2
import json
import os
from datetime import datetime
from ultralytics import YOLO

# Ensure database access
from database.database import SessionLocal
from database import crud

# We'll use the ultralytics built-in ByteTrack
class AnimalVisionPipeline:
    def __init__(self, model_path="yolov8n.pt"):
        self.model = YOLO(model_path)
        self.target_classes = ["cow", "dog", "horse", "sheep", "elephant", "bird", "bear", "zebra", "giraffe", "person"]
        
        # Track active animals to log durations
        self.active_tracks = {} # {tracker_id: {"species": name, "entry_time": dt, "max_conf": float, "last_seen": dt}}
        
        # Ensure dataset folder exists
        os.makedirs("data/dataset/captured", exist_ok=True)

    def process_frame(self, frame, db_session):
        # Run YOLO with ByteTrack enabled
        # persist=True keeps tracks across frames
        results = self.model.track(frame, persist=True, classes=[14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0], verbose=False) # COCO indices for animals/person
        
        current_time = datetime.now()
        current_frame_ids = set()
        
        for r in results:
            boxes = r.boxes
            if boxes is None or boxes.id is None:
                continue
                
            for box in boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                track_id = int(box.id[0])
                species = self.model.names[cls_id]
                
                current_frame_ids.add(track_id)
                
                # Draw on frame
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, f"{species} ID:{track_id}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                
                cv2.imwrite("outputs/figure_3_animal_detection.png", frame)
                # Handle tracking logic
                if track_id not in self.active_tracks:
                    # New animal detected
                    self.active_tracks[track_id] = {
                        "species": species,
                        "entry_time": current_time,
                        "max_conf": conf,
                        "last_seen": current_time,
                        "bbox": [x1, y1, x2, y2]
                    }
                    
                    # Save a snapshot for the Dataset Repository
                    crop = frame[max(0, y1):min(frame.shape[0], y2), max(0, x1):min(frame.shape[1], x2)]
                    if crop.size > 0:
                        image_path = f"data/dataset/captured/{species}_{track_id}_{int(current_time.timestamp())}.jpg"
                        cv2.imwrite(image_path, crop)
                        self.active_tracks[track_id]["image_path"] = image_path
                else:
                    # Update existing track
                    self.active_tracks[track_id]["last_seen"] = current_time
                    self.active_tracks[track_id]["max_conf"] = max(self.active_tracks[track_id]["max_conf"], conf)
                    self.active_tracks[track_id]["bbox"] = [x1, y1, x2, y2]
        
        # Check for animals that have left the frame (not seen for 3 seconds)
        lost_tracks = []
        for tid, data in self.active_tracks.items():
            if tid not in current_frame_ids:
                time_lost = (current_time - data["last_seen"]).total_seconds()
                if time_lost > 3.0: # Grace period
                    lost_tracks.append(tid)
                    
        # Log lost tracks to database
        for tid in lost_tracks:
            data = self.active_tracks.pop(tid)
            # Log event
            event = crud.log_intrusion(
                db=db_session,
                species_name=data["species"],
                tracker_id=tid,
                entry_time=data["entry_time"],
                exit_time=data["last_seen"],
                confidence=data["max_conf"],
                weather="Simulated_Clear"
            )
            # Log metadata
            metadata = {
                "final_bbox": data["bbox"],
                "total_duration_seconds": (data["last_seen"] - data["entry_time"]).total_seconds()
            }
            if "image_path" in data:
                crud.save_dataset_metadata(
                    db=db_session,
                    event_id=event.id,
                    image_path=data["image_path"],
                    metadata_json=json.dumps(metadata),
                    timestamp=data["entry_time"]
                )
                
        return frame
