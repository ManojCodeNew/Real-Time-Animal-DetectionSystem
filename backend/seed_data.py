import os
import sys
import random
from datetime import datetime, timedelta

# Add parent directory to path so we can import database modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database.database import init_db, SessionLocal
from database import crud

def generate_synthetic_data(db):
    print("Generating synthetic historical data...")
    species_list = ["wild_boar", "elephant", "macaque", "nilgai"]
    weather_conds = ["Clear", "Fog", "Rain", "Night"]
    
    now = datetime.now()
    
    for i in range(200): # 200 events over the past 30 days
        days_ago = random.randint(1, 30)
        
        species = random.choice(species_list)
        # Assign typical intrusion times to test clustering/prediction
        if species == "wild_boar":
            # Boars mostly come around 1 AM - 3 AM
            hour = random.randint(1, 3)
        elif species == "elephant":
            # Elephants mostly around 4 AM - 6 AM
            hour = random.randint(4, 6)
        elif species == "macaque":
            # Macaques during the day 10 AM - 2 PM
            hour = random.randint(10, 14)
        else:
            hour = random.randint(0, 23)
            
        minute = random.randint(0, 59)
        entry_time = now - timedelta(days=days_ago)
        entry_time = entry_time.replace(hour=hour, minute=minute)
        
        duration = random.randint(60, 1800) # 1 min to 30 mins
        exit_time = entry_time + timedelta(seconds=duration)
        
        conf = round(random.uniform(0.60, 0.98), 2)
        weather = random.choice(weather_conds)
        
        # Determine simulated brightness based on the hour
        if 6 <= hour <= 18:
            brightness_val = round(random.uniform(80.0, 200.0), 2)
            b_path = "daylight"
        else:
            brightness_val = round(random.uniform(15.0, 48.0), 2)
            b_path = "low_light"
            
        event = crud.log_intrusion(
            db=db,
            species_name=species,
            tracker_id=i+1000,
            entry_time=entry_time,
            exit_time=exit_time,
            confidence=conf,
            weather=weather,
            source="seed",
            confirmed=None,
            status="active",
            brightness=brightness_val,
            brightness_path=b_path
        )
        
        # Save a fake dataset metadata row
        crud.save_dataset_metadata(
            db=db,
            event_id=event.id,
            image_path=f"data/dataset/{species}_{event.id}.jpg",
            metadata_json='{"bbox": [100, 200, 300, 400]}',
            timestamp=entry_time
        )
        
    print("Seeding complete.")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "data")
    dataset_dir = os.path.join(data_dir, "dataset")
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(dataset_dir, exist_ok=True)
    
    # Remove old database if exists to rebuild with the new schema columns
    db_path = os.path.join(data_dir, "farm_security.db")
    if os.path.exists(db_path):
        print(f"Removing old database at {db_path} to apply new schema...")
        try:
            os.remove(db_path)
        except Exception as e:
            print(f"Warning: could not remove database: {e}")
            
    init_db()
    db = SessionLocal()
    
    # Generate fresh seeded data with source='seed'
    generate_synthetic_data(db)
        
    db.close()
