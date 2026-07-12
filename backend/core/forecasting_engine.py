import os
import json
import sys
from datetime import datetime, timedelta

# Add parent directories to path
script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(script_dir, ".."))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

from core.prediction import StatisticalPredictor

FORECASTS_FILE = os.path.join(backend_dir, "data", "forecasts.json")

def recalculate(species_name, db):
    """
    Recalculates the temporal intrusion forecast for a specific species.
    Applies the Phase 0/3 transition logic (MIN_LIVE_EVENTS = 15).
    Saves the output to data/forecasts.json.
    """
    # 1. Calculate prediction using the StatisticalPredictor
    predictor = StatisticalPredictor(db)
    pred = predictor.predict_next_intrusion(species_name)
    
    # 2. Reformat to match the required 'data_maturity' spec
    if "data_source" in pred:
        pred["data_maturity"] = pred.pop("data_source")
    else:
        pred["data_maturity"] = "seed"
        
    # Add within 30 hour boolean flag
    if pred["status"] == "success":
        pred_time = datetime.strptime(pred["predicted_time"], "%Y-%m-%d %H:%M:%S")
        now = datetime.now()
        pred["is_within_30h"] = now <= pred_time <= (now + timedelta(hours=30))
    else:
        pred["is_within_30h"] = False
        
    # 3. Load existing pre-calculated forecasts
    os.makedirs(os.path.dirname(FORECASTS_FILE), exist_ok=True)
    forecasts = {}
    if os.path.exists(FORECASTS_FILE):
        try:
            with open(FORECASTS_FILE, "r") as f:
                forecasts = json.load(f)
        except Exception:
            pass
            
    # 4. Update the forecast for this species
    forecasts[species_name] = pred
    
    # 5. Save back to disk
    with open(FORECASTS_FILE, "w") as f:
        json.dump(forecasts, f, indent=4)
        
    print(f"[FORECAST] Recalculated forecast for '{species_name}'. Maturity: {pred['data_maturity']}, Success: {pred['status']}")
    return pred

def recalculate_all(db):
    """Recalculate forecasts for all 4 default species."""
    species_list = ["wild_boar", "elephant", "macaque", "nilgai"]
    results = {}
    for sp in species_list:
        results[sp] = recalculate(sp, db)
    return results

if __name__ == "__main__":
    # Test script execution
    from database.database import SessionLocal
    db = SessionLocal()
    try:
        print("Testing forecasting recalculation for all species...")
        recalculate_all(db)
    finally:
        db.close()
