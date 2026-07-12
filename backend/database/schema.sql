-- SQLite database schema for the AI Wildlife Intrusion System

CREATE TABLE IF NOT EXISTS animal_species (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    risk_level TEXT
);

CREATE TABLE IF NOT EXISTS intrusion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id INTEGER,
    tracker_id INTEGER,
    entry_time DATETIME NOT NULL,
    exit_time DATETIME NOT NULL,
    duration_seconds INTEGER,
    confidence_score REAL,
    weather_condition TEXT,
    source TEXT DEFAULT 'live',
    confirmed BOOLEAN DEFAULT NULL,
    status TEXT DEFAULT 'active',
    brightness REAL,
    brightness_path TEXT,
    FOREIGN KEY (species_id) REFERENCES animal_species (id)
);

CREATE TABLE IF NOT EXISTS dataset_repository (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    image_path TEXT,
    metadata_json TEXT,
    timestamp DATETIME NOT NULL,
    FOREIGN KEY (event_id) REFERENCES intrusion_events (id)
);
