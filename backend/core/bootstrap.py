import os
import random
from datetime import datetime, timedelta
from database import models, crud

def create_bootstrap_records(db):
    """
    Creates exactly 5 realistic historical baseline intrusion records per threat species
    to initialize the forecasting engine. All records are flagged as source='bootstrap'.
    """
    print("[BOOTSTRAP] Initializing minimal historical baseline dataset...")
    species_list = ["wild_boar", "elephant", "macaque", "nilgai"]
    weather_conds = ["Clear", "Fog", "Rain", "Night"]
    now = datetime.now()
    
    # Counter for tracker IDs
    tracker_counter = 5000
    
    for species in species_list:
        for i in range(5): # Generate exactly 5 events per species
            days_ago = random.randint(1, 15)
            
            # Typical activity hours per species
            if species == "wild_boar":
                hour = random.choice([1, 2, 3]) # Night
            elif species == "elephant":
                hour = random.choice([4, 5, 6]) # Dawn
            elif species == "macaque":
                hour = random.choice([10, 11, 12, 13, 14]) # Day
            elif species == "nilgai":
                hour = random.choice([17, 18, 19, 20]) # Dusk
            else:
                hour = random.randint(0, 23)
                
            minute = random.randint(0, 59)
            entry_time = now - timedelta(days=days_ago)
            entry_time = entry_time.replace(hour=hour, minute=minute, second=0, microsecond=0)
            
            duration = random.randint(120, 900) # 2 mins to 15 mins
            exit_time = entry_time + timedelta(seconds=duration)
            
            conf = round(random.uniform(0.70, 0.95), 2)
            weather = random.choice(weather_conds)
            
            # Determine brightness based on daylight
            if 6 <= hour <= 18:
                brightness_val = round(random.uniform(80.0, 180.0), 2)
                b_path = "daylight"
            else:
                brightness_val = round(random.uniform(15.0, 48.0), 2)
                b_path = "low_light"
                
            tracker_counter += 1
            
            # Insert into database using CRUD helper
            event = crud.log_intrusion(
                db=db,
                species_name=species,
                tracker_id=tracker_counter,
                entry_time=entry_time,
                exit_time=exit_time,
                confidence=conf,
                weather=weather,
                source="bootstrap",
                confirmed=None,
                status="active",
                brightness=brightness_val,
                brightness_path=b_path
            )
            
            # Insert simple dataset metadata
            crud.save_dataset_metadata(
                db=db,
                event_id=event.id,
                image_path=f"data/dataset/{species}_boot_{event.id}.jpg",
                metadata_json='{"bbox": [120, 180, 280, 360]}',
                timestamp=entry_time
            )
            
    print(f"[BOOTSTRAP] Successfully generated {20} records. Seeding completed programmatically.")
