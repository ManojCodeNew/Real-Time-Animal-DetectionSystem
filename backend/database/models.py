from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, create_engine, Boolean
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class AnimalSpecies(Base):
    __tablename__ = 'animal_species'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    risk_level = Column(String) # High, Medium, Low
    
    events = relationship("IntrusionEvent", back_populates="species")


class IntrusionEvent(Base):
    __tablename__ = 'intrusion_events'
    
    id = Column(Integer, primary_key=True, index=True)
    species_id = Column(Integer, ForeignKey('animal_species.id'))
    tracker_id = Column(Integer) # From ByteTrack
    entry_time = Column(DateTime)
    exit_time = Column(DateTime)
    duration_seconds = Column(Integer)
    confidence_score = Column(Float)
    weather_condition = Column(String) # Simulated for now
    source = Column(String, default="live") # 'seed' or 'live'
    confirmed = Column(Boolean, nullable=True, default=None) # NULL = unreviewed, TRUE = confirmed, FALSE = corrected
    status = Column(String, default="active") # 'active', 'corrected', 'false_positive'
    brightness = Column(Float, nullable=True) # Average brightness of the session
    brightness_path = Column(String, nullable=True) # 'low_light' or 'daylight'
    
    species = relationship("AnimalSpecies", back_populates="events")
    dataset_metadata = relationship("DatasetRepository", back_populates="event")


class DatasetRepository(Base):
    __tablename__ = 'dataset_repository'
    
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey('intrusion_events.id'))
    image_path = Column(String) # Path to saved crop of the animal
    metadata_json = Column(String) # Bounding box coords, etc.
    timestamp = Column(DateTime)
    
    event = relationship("IntrusionEvent", back_populates="dataset_metadata")
