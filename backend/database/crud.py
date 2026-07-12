from sqlalchemy.orm import Session
from datetime import datetime
from . import models

def get_or_create_species(db: Session, name: str):
    species = db.query(models.AnimalSpecies).filter(models.AnimalSpecies.name == name).first()
    if not species:
        species = models.AnimalSpecies(name=name, risk_level="High")
        db.add(species)
        db.commit()
        db.refresh(species)
    return species

def log_intrusion(db: Session, species_name: str, tracker_id: int, entry_time: datetime, exit_time: datetime, confidence: float, weather: str, source: str = "live", confirmed: bool = None, status: str = "active", brightness: float = None, brightness_path: str = None):
    species = get_or_create_species(db, species_name)
    duration = (exit_time - entry_time).total_seconds()
    
    event = models.IntrusionEvent(
        species_id=species.id,
        tracker_id=tracker_id,
        entry_time=entry_time,
        exit_time=exit_time,
        duration_seconds=int(duration),
        confidence_score=confidence,
        weather_condition=weather,
        source=source,
        confirmed=confirmed,
        status=status,
        brightness=brightness,
        brightness_path=brightness_path
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event

def save_dataset_metadata(db: Session, event_id: int, image_path: str, metadata_json: str, timestamp: datetime):
    dataset = models.DatasetRepository(
        event_id=event_id,
        image_path=image_path,
        metadata_json=metadata_json,
        timestamp=timestamp
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset

def get_recent_events(db: Session, limit: int = 50):
    return db.query(models.IntrusionEvent).order_by(models.IntrusionEvent.entry_time.desc()).limit(limit).all()
