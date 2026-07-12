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
                settings = json.load(f)
                if "prediction_mode" not in settings:
                    settings["prediction_mode"] = "automatic"
                return settings
        except Exception:
            pass
    return {"email": "farmer@example.com", "notifications_enabled": True, "prediction_mode": "automatic"}

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

# 4. GET /api/notifications - In-site notification feed of live alerts & predictive alerts
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
        now = datetime.now()
        
        # 1. Fetch upcoming predictive warnings (within next 30 minutes)
        forecasts_file = os.path.join(script_dir, "data", "forecasts.json")
        if os.path.exists(forecasts_file):
            try:
                with open(forecasts_file, "r") as f:
                    forecasts = json.load(f)
                for sp, pred in forecasts.items():
                    if pred.get("status") == "success" and pred.get("predicted_time"):
                        pred_time = datetime.strptime(pred["predicted_time"], "%Y-%m-%d %H:%M:%S")
                        time_diff = (pred_time - now).total_seconds() / 60.0
                        if 0 <= time_diff <= 30.0:
                            notifications.append({
                                "id": f"pred_{sp}_{pred['predicted_time']}",
                                "message": f"PREDICTIVE WARNING: {sp.replace('_', ' ').capitalize()} arrival predicted in {int(time_diff)} minutes ({pred['predicted_time']})!",
                                "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                                "brightness_path": "warning",
                                "confidence": pred["confidence_percentage"] / 100.0,
                                "email_sent": True
                            })
            except Exception as e:
                print("Error calculating onsite predictive notifications:", e)

        # 2. Append live intrusion events
        for e in events:
            notifications.append({
                "id": e.id,
                "message": f"CRITICAL: {e.species.name.replace('_', ' ').capitalize()} detected on farm boundaries!",
                "time": e.entry_time.strftime("%Y-%m-%d %H:%M:%S"),
                "brightness_path": e.brightness_path,
                "confidence": e.confidence_score,
                "email_sent": True
            })
            
        # Sort notifications by time descending
        notifications = sorted(notifications, key=lambda x: x["time"], reverse=True)
        return jsonify(notifications[:20])
    finally:
        db.close()

# 5. POST /api/settings/email - Save or toggle settings
@app.route("/api/settings/email", methods=["POST"])
def post_email_setting():
    data = request.json or {}
    email = data.get("email")
    enabled = data.get("enabled", True)
    prediction_mode = data.get("prediction_mode", "automatic")
    
    if not email:
        return jsonify({"error": "email parameter is required"}), 400
        
    settings = load_settings()
    settings["email"] = email
    settings["notifications_enabled"] = enabled
    settings["prediction_mode"] = prediction_mode
    save_settings(settings)
    
    # Simulate writing email log registration
    email_log = os.path.join(script_dir, "data", "email_notifications.log")
    with open(email_log, "a") as f:
         f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Settings Updated: Alerts enabled for {email}. Prediction mode: {prediction_mode}\n")
         
    return jsonify({
        "message": "Email settings saved successfully",
        "settings": settings
    })

# 6. Camera Pipeline Control endpoints (Phase 6 Detection stream)
from core.camera_manager import CameraStreamManager
from flask import Response

@app.route("/api/camera/start", methods=["POST"])
def start_camera():
    active = CameraStreamManager.get_instance().start()
    return jsonify({"message": "Camera pipeline activated", "active": active})

@app.route("/api/camera/stop", methods=["POST"])
def stop_camera():
    CameraStreamManager.get_instance().stop()
    return jsonify({"message": "Camera pipeline deactivated", "active": False})

@app.route("/api/camera/status", methods=["GET"])
def get_camera_status():
    active = CameraStreamManager.get_instance().get_status()
    return jsonify({"active": active})

@app.route("/api/camera/stream", methods=["GET"])
def camera_stream():
    manager = CameraStreamManager.get_instance()
    
    # If not active, return standard offline placeholder image
    if not manager.get_status():
        placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(placeholder, "CAMERA FEED OFFLINE", (140, 250), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
        cv2.putText(placeholder, "Click 'Start Live Feed' to active YOLOv8 detection.", (80, 290), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        ret, jpeg = cv2.imencode('.jpg', placeholder)
        return Response(jpeg.tobytes(), mimetype='image/jpeg')
        
    def gen():
        while manager.get_status():
            frame = manager.get_frame()
            if frame:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
            time.sleep(0.04)  # ~25 FPS streaming
    return Response(gen(), mimetype='multipart/x-mixed-replace; boundary=frame')

# Serve captured image crops for the Detection Gallery
@app.route("/api/images/<path:filename>", methods=["GET"])
def get_image(filename):
    directory = os.path.abspath(os.path.join(script_dir, "data", "dataset", "captured"))
    if not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)
    return send_from_directory(directory, filename)

# Background scheduler daemon for 30m predictive alerts check (Phase 5)
import threading
import time

def start_forecast_scheduler():
    def run_scheduler():
        # Keep track of warnings sent to avoid repeated spamming
        sent_warnings = set()
        
        while True:
            time.sleep(60)  # Check predictions every 60 seconds
            db = SessionLocal()
            try:
                now = datetime.now()
                settings = load_settings()
                if not settings.get("notifications_enabled", True):
                    continue
                    
                forecasts_file = os.path.join(script_dir, "data", "forecasts.json")
                if os.path.exists(forecasts_file):
                    with open(forecasts_file, "r") as f:
                        forecasts = json.load(f)
                        
                    for sp, pred in forecasts.items():
                        if pred.get("status") == "success" and pred.get("predicted_time"):
                            pred_time = datetime.strptime(pred["predicted_time"], "%Y-%m-%d %H:%M:%S")
                            time_diff = (pred_time - now).total_seconds() / 60.0
                            
                            # Trigger email alert warning 30 minutes before expected arrival
                            if 28.5 <= time_diff <= 30.5:
                                warn_key = f"{sp}_{pred['predicted_time']}"
                                if warn_key not in sent_warnings:
                                    sent_warnings.add(warn_key)
                                    
                                    # Log the forecast warning email (Gap 1 alert)
                                    from core.notifications import log_forecast_alert
                                    log_forecast_alert(sp, pred["predicted_time"], pred["confidence_percentage"], pred["peak_activity_window"])
            except Exception as e:
                print("[SCHEDULER] Error during scheduled recalculation:", e)
            finally:
                db.close()
                
    thread = threading.Thread(target=run_scheduler, daemon=True)
    thread.start()

start_forecast_scheduler()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
