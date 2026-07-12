from flask import Flask, request, jsonify
from flask_cors import CORS
import cv2
import tempfile
import os

from database import models
from database.database import engine, SessionLocal
from database import crud
from core.prediction import StatisticalPredictor
from core.yolo_engine import AnimalVisionPipeline

# Create tables if not exist
models.Base.metadata.create_all(bind=engine)

app = Flask(__name__)
CORS(app) # Allow React frontend to connect

# Initialize AI Pipeline globally
vision_pipeline = AnimalVisionPipeline()

@app.route("/", methods=["GET"])
def read_root():
    return jsonify({"message": "AI Animal Intrusion Prediction System Prototype Active (Flask)"})

@app.route("/api/events", methods=["GET"])
def get_events():
    limit = int(request.args.get("limit", 50))
    db = SessionLocal()
    try:
        events = crud.get_recent_events(db, limit=limit)
        return jsonify([{
            "id": e.id,
            "species": e.species.name,
            "entry_time": e.entry_time.strftime("%Y-%m-%d %H:%M:%S"),
            "exit_time": e.exit_time.strftime("%Y-%m-%d %H:%M:%S"),
            "duration": e.duration_seconds,
            "confidence": e.confidence_score
        } for e in events])
    finally:
        db.close()

@app.route("/api/analytics/summary", methods=["GET"])
def get_analytics():
    db = SessionLocal()
    try:
        predictor = StatisticalPredictor(db)
        return jsonify(predictor.get_analytics_summary())
    finally:
        db.close()

@app.route("/api/predict/<species_name>", methods=["GET"])
def predict_intrusion(species_name):
    db = SessionLocal()
    try:
        predictor = StatisticalPredictor(db)
        return jsonify(predictor.predict_next_intrusion(species_name))
    finally:
        db.close()

@app.route("/api/video/process", methods=["POST"])
def process_video_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
        
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    file.save(temp_file.name)
    
    db = SessionLocal()
    cap = cv2.VideoCapture(temp_file.name)
    frame_count = 0
    
    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            # Process every 5th frame to speed up demo
            if frame_count % 5 == 0:
                vision_pipeline.process_frame(frame, db)
                
            frame_count += 1
            
        return jsonify({"message": f"Processed {frame_count} frames. Events logged to database."})
    finally:
        cap.release()
        os.unlink(temp_file.name)
        db.close()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
