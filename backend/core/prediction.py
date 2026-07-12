from datetime import datetime, timedelta
from database import crud
import collections
import os

class StatisticalPredictor:
    def __init__(self, db_session):
        self.db = db_session

    def predict_next_intrusion(self, species_name: str):
        """
        Baseline prediction algorithm using historical frequency analysis.
        Transition from seed data to live data when MIN_LIVE_EVENTS = 15 is met.
        """
        # Fetch all events for the species
        events = crud.get_recent_events(self.db, limit=500)
        species_events = [e for e in events if e.species.name == species_name]
        
        # Load prediction mode from settings
        prediction_mode = "automatic"
        settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "settings.json")
        if os.path.exists(settings_path):
            try:
                import json
                with open(settings_path, "r") as f:
                    settings = json.load(f)
                    prediction_mode = settings.get("prediction_mode", "automatic")
            except Exception:
                pass

        # Filter for valid events (exclude false positives and unconfirmed live events)
        valid_events = []
        for e in species_events:
            if e.status not in ["active", "corrected"]:
                continue
            if e.source == "live" and e.confirmed is not True:
                # Exclude unconfirmed live events to prevent poisoning the forecast
                continue
            valid_events.append(e)
            
        # Count live valid events
        live_events = [e for e in valid_events if e.source == "live"]
        seed_events = [e for e in valid_events if e.source == "seed"]
        
        # Decide which events to use based on prediction_mode
        if prediction_mode == "seed_only":
            calculation_events = seed_events
            data_source = "seed"
        elif prediction_mode == "live_only":
            calculation_events = live_events
            data_source = "live"
        else:  # "automatic" (Hybrid 15-event threshold)
            MIN_LIVE_EVENTS = 15
            if len(live_events) >= MIN_LIVE_EVENTS:
                calculation_events = live_events
                data_source = "live"
            else:
                calculation_events = valid_events
                data_source = "seed"
            
        if len(calculation_events) < 5:
            return {
                "species": species_name,
                "status": "insufficient_data",
                "message": "Need at least 5 historical events to predict.",
                "data_source": data_source,
                "live_events_count": len(live_events)
            }
            
        # Extract hours of entry
        entry_hours = [e.entry_time.hour for e in calculation_events]
        
        # Calculate the most frequent hour bin (Mode)
        hour_counts = collections.Counter(entry_hours)
        peak_hour = hour_counts.most_common(1)[0][0]
        
        # Calculate average minute within that peak hour
        peak_hour_events = [e for e in calculation_events if e.entry_time.hour == peak_hour]
        minutes = [e.entry_time.minute for e in peak_hour_events]
        avg_minute = int(sum(minutes) / len(minutes))
        
        # Calculate simple confidence
        variance = sum((m - avg_minute) ** 2 for m in minutes) / len(minutes)
        std_dev = variance ** 0.5
        
        confidence = max(10.0, min(95.0, 100.0 - std_dev))
            
        # Calculate next predicted time
        now = datetime.now()
        predicted_time = now.replace(hour=peak_hour, minute=avg_minute, second=0, microsecond=0)
        
        if predicted_time < now:
            # If the peak time has already passed today, predict for tomorrow
            predicted_time += timedelta(days=1)
            
        return {
            "species": species_name,
            "status": "success",
            "predicted_time": predicted_time.strftime("%Y-%m-%d %H:%M:%S"),
            "confidence_percentage": round(confidence, 1),
            "historical_data_points_used": len(calculation_events),
            "live_events_count": len(live_events),
            "data_source": data_source,
            "peak_activity_window": f"{peak_hour:02d}:00 - {peak_hour:02d}:59"
        }
        
    def get_analytics_summary(self):
        all_events = crud.get_recent_events(self.db, limit=1000)
        # Filter for valid events (exclude false positives)
        events = [e for e in all_events if e.status in ["active", "corrected"]]
        if not events:
            return {
                "total_intrusions": 0,
                "species_breakdown": {},
                "hourly_distribution": {},
                "avg_duration_seconds": 0
            }
            
        species_counts = collections.Counter([e.species.name for e in events])
        hourly_dist = collections.Counter([e.entry_time.hour for e in events])
        
        avg_duration = sum(e.duration_seconds for e in events) / len(events)
        
        return {
            "total_intrusions": len(events),
            "species_breakdown": dict(species_counts),
            "hourly_distribution": dict(sorted(hourly_dist.items())),
            "avg_duration_seconds": round(avg_duration, 1)
        }
