import os
import json
import sys
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# Add current directory to path
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(script_dir)

from database import models, crud
from database.database import engine, SessionLocal
from core.prediction import StatisticalPredictor

# Initialize tables
models.Base.metadata.create_all(bind=engine)

app = Flask(__name__)
CORS(app)  # Allow React frontend to connect

# Settings storage setup
SETTINGS_FILE = os.path.join(script_dir, "data", "settings.json")
os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)

def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"email": "farmer@example.com", "notifications_enabled": True}

def save_settings(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)

@app.route("/", methods=["GET"])
def index():
    return jsonify({"message": "AI Wildlife Intrusion API Server Active"})

# 1. GET /api/detections - Last 10 events, status='active' (or corrected), newest first
@app.route("/api/detections", methods=["GET"])
def get_detections():
    db = SessionLocal()
    try:
        # Fetch events where status is 'active' or 'corrected', ordered by newest first
        events = db.query(models.IntrusionEvent)\
            .filter(models.IntrusionEvent.status.in_(["active", "corrected"]))\
            .order_by(models.IntrusionEvent.entry_time.desc())\
            .limit(10)\
            .all()
            
        result = []
        for e in events:
            # Check if there is an image in dataset metadata
            image_filename = None
            if e.dataset_metadata:
                image_filename = os.path.basename(e.dataset_metadata[0].image_path)
                
            result.append({
                "id": e.id,
                "species": e.species.name,
                "tracker_id": e.tracker_id,
                "entry_time": e.entry_time.strftime("%Y-%m-%d %H:%M:%S"),
                "exit_time": e.exit_time.strftime("%Y-%m-%d %H:%M:%S"),
                "duration": e.duration_seconds,
                "confidence": e.confidence_score,
                "source": e.source,
                "confirmed": e.confirmed,
                "status": e.status,
                "brightness": e.brightness,
                "brightness_path": e.brightness_path,
                "image_url": f"http://localhost:8000/api/images/{image_filename}" if image_filename else None
            })
        return jsonify(result)
    finally:
        db.close()

# 2. GET /api/predictions - Forecast for all 4 species, next 30h
@app.route("/api/predictions", methods=["GET"])
def get_predictions():
    db = SessionLocal()
    try:
        from core.forecasting_engine import FORECASTS_FILE, recalculate_all
        
        # Load forecasts or recalculate if file not present
        forecasts = {}
        if os.path.exists(FORECASTS_FILE):
            try:
                with open(FORECASTS_FILE, "r") as f:
                    forecasts = json.load(f)
            except Exception:
                pass
                
        # If any species is missing, recalculate all
        species_list = ["wild_boar", "elephant", "macaque", "nilgai"]
        if not forecasts or any(sp not in forecasts for sp in species_list):
            forecasts = recalculate_all(db)
            
        # Re-check is_within_30h dynamically based on current time
        now = datetime.now()
        thirty_hours_later = now + timedelta(hours=30)
        
        for sp, pred in forecasts.items():
            if pred.get("status") == "success":
                try:
                    pred_time = datetime.strptime(pred["predicted_time"], "%Y-%m-%d %H:%M:%S")
                    pred["is_within_30h"] = now <= pred_time <= thirty_hours_later
                except Exception:
                    pred["is_within_30h"] = False
            else:
                pred["is_within_30h"] = False
                
        return jsonify(forecasts)
    finally:
        db.close()

# 3. POST /api/feedback/detection/<id> - Give feedback on detection
@app.route("/api/feedback/detection/<int:id>", methods=["POST"])
def post_feedback(id):
    data = request.json or {}
    confirmed = data.get("confirmed")
    correct_species = data.get("correct_species")
    false_positive = data.get("false_positive", False)
    
    db = SessionLocal()
    try:
        event = db.query(models.IntrusionEvent).filter(models.IntrusionEvent.id == id).first()
        if not event:
            return jsonify({"error": "Event not found"}), 404
            
        if confirmed is True:
            # User confirmed the AI classification was correct
            event.confirmed = True
            event.status = "active"
            
        elif confirmed is False:
            if false_positive:
                # User marked the event as a false positive
                event.status = "false_positive"
                event.confirmed = False
            elif correct_species:
                # User corrected the species class
                # Resolve or create the new species
                species = crud.get_or_create_species(db, correct_species)
                event.species_id = species.id
                event.confirmed = True
                event.status = "corrected"
            else:
                return jsonify({"error": "Must specify correct_species or false_positive when confirmed is False"}), 400
        else:
            return jsonify({"error": "confirmed parameter is required"}), 400
            
        db.commit()
        
        # Recalculate forecast for this species using Phase 3 engine
        from core.forecasting_engine import recalculate
        updated_forecast = recalculate(event.species.name, db)
        
        return jsonify({
            "message": "Feedback submitted and forecast updated successfully",
            "event_id": event.id,
            "new_status": event.status,
            "new_confirmed": event.confirmed,
            "new_species": event.species.name,
            "updated_forecast": updated_forecast
        })
    finally:
        db.close()

# 4. GET /api/notifications - In-site notification feed of live alerts
@app.route("/api/notifications", methods=["GET"])
def get_notifications():
    db = SessionLocal()
    try:
        # Get last 10 live and active events
        events = db.query(models.IntrusionEvent)\
            .filter(models.IntrusionEvent.source == "live")\
            .filter(models.IntrusionEvent.status == "active")\
            .order_by(models.IntrusionEvent.entry_time.desc())\
            .limit(10)\
            .all()
            
        notifications = []
        for e in events:
            notifications.append({
                "id": e.id,
                "message": f"CRITICAL: {e.species.name.replace('_', ' ').capitalize()} detected on farm boundaries!",
                "time": e.entry_time.strftime("%Y-%m-%d %H:%M:%S"),
                "brightness_path": e.brightness_path,
                "confidence": e.confidence_score,
                "email_sent": True  # In our simulated layer, we send an email notification as well
            })
        return jsonify(notifications)
    finally:
        db.close()

# 5. POST /api/settings/email - Save or toggle email notification address
@app.route("/api/settings/email", methods=["POST"])
def post_email_setting():
    data = request.json or {}
    email = data.get("email")
    enabled = data.get("enabled", True)
    
    if not email:
        return jsonify({"error": "email parameter is required"}), 400
        
    settings = load_settings()
    settings["email"] = email
    settings["notifications_enabled"] = enabled
    save_settings(settings)
    
    # Simulate writing email log registration
    email_log = os.path.join(script_dir, "data", "email_notifications.log")
    with open(email_log, "a") as f:
         f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Settings Updated: Alerts enabled for {email}\n")
         
    return jsonify({
        "message": "Email settings saved successfully",
        "settings": settings
    })

# Serve captured image crops for the Detection Gallery
@app.route("/api/images/<path:filename>", methods=["GET"])
def get_image(filename):
    directory = os.path.abspath(os.path.join(script_dir, "data", "dataset", "captured"))
    if not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
    return send_from_directory(directory, filename)

# Background scheduler daemon for hourly prediction recalculation
import threading
import time

def start_forecast_scheduler():
    def run_scheduler():
        while True:
            time.sleep(3600)  # Every hour
            print("[SCHEDULER] Running scheduled hourly forecast recalculation...")
            db = SessionLocal()
            try:
                from core.forecasting_engine import recalculate_all
                recalculate_all(db)
            except Exception as e:
                print("[SCHEDULER] Error during scheduled recalculation:", e)
            finally:
                db.close()
                
    thread = threading.Thread(target=run_scheduler, daemon=True)
    thread.start()

start_forecast_scheduler()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
