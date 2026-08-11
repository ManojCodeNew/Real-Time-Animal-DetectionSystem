import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';

const API_BASE = import.meta.env?.VITE_API_BASE || 'http://localhost:8000/api';
const COLORS = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b'];

function FarmGuard_Dashboard() {
  const [detections, setDetections] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [emailSettings, setEmailSettings] = useState({ 
    email: 'farmer@example.com', 
    enabled: true,
    prediction_mode: 'automatic',
    smtp_sender: '',
    smtp_password: '',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    min_live_events: 10
  });
  const [loading, setLoading] = useState(true);
  
  // Tabs & Theme States
  const [activeTab, setActiveTab] = useState('dashboard');
  const [lightTheme, setLightTheme] = useState(false);
  
  // Camera Selection States
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(-1);
  const [cameraStatus, setCameraStatus] = useState({
    active: false,
    state: 'idle',
    phase: 'Ready',
    camera_index: -1,
    active_tracks_count: 0,
    error: null
  });
  
  // Correction States
  const [correctingId, setCorrectingId] = useState(null);
  const [newSpeciesVal, setNewSpeciesVal] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [streamCacheBreaker, setStreamCacheBreaker] = useState(Date.now());

  useEffect(() => {
    // 1. Fetch available camera devices
    const fetchCameraDevices = async () => {
      try {
        const res = await axios.get(`${API_BASE}/camera/list`);
        setCameraDevices(res.data.cameras || []);
        if (res.data.cameras && res.data.cameras.length > 0) {
          setSelectedCameraId(res.data.cameras[0].id);
        }
      } catch (error) {
        console.error("Error fetching camera devices:", error);
      }
    };
    fetchCameraDevices();

    // 2. Initial Fetch
    fetchInitialData();
    
    // 3. Poll camera status, detections, notifications, and forecasts every 3 seconds
    const pollInterval = setInterval(async () => {
      try {
        const [detRes, notifRes, predRes, camRes] = await Promise.all([
          axios.get(`${API_BASE}/detections`),
          axios.get(`${API_BASE}/notifications`),
          axios.get(`${API_BASE}/predictions`),
          axios.get(`${API_BASE}/camera/status`)
        ]);
        setDetections(detRes.data);
        setNotifications(notifRes.data);
        setPredictions(predRes.data);
        setCameraStatus(camRes.data);
      } catch (error) {
        console.error("Error polling real-time events:", error);
      }
    }, 3000);
    
    return () => clearInterval(pollInterval);
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const [detRes, predRes, notifRes, camRes] = await Promise.all([
        axios.get(`${API_BASE}/detections`),
        axios.get(`${API_BASE}/predictions`),
        axios.get(`${API_BASE}/notifications`),
        axios.get(`${API_BASE}/camera/status`)
      ]);
      setDetections(detRes.data);
      setPredictions(predRes.data);
      setNotifications(notifRes.data);
      setCameraStatus(camRes.data);
      
      // Load configurations
      try {
        const settingsRes = await axios.get(`${API_BASE}/settings`);
        setEmailSettings({
          email: settingsRes.data.email || 'farmer@example.com',
          enabled: settingsRes.data.notifications_enabled !== undefined ? settingsRes.data.notifications_enabled : true,
          prediction_mode: settingsRes.data.prediction_mode || 'automatic',
          smtp_sender: settingsRes.data.smtp_sender || '',
          smtp_password: settingsRes.data.smtp_password || '',
          smtp_host: settingsRes.data.smtp_host || 'smtp.gmail.com',
          smtp_port: settingsRes.data.smtp_port || 587,
          min_live_events: settingsRes.data.min_live_events || 10
        });
      } catch (err) {
        console.error("Error loading settings configurations:", err);
      }
    } catch (error) {
      console.error("Error fetching console data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (id, confirmed, correctSpecies = null, falsePositive = false) => {
    try {
      const payload = { confirmed };
      if (correctSpecies) payload.correct_species = correctSpecies;
      if (falsePositive) payload.false_positive = true;
      
      await axios.post(`${API_BASE}/feedback/detection/${id}`, payload);
      
      setCorrectingId(null);
      setNewSpeciesVal('');
      
      // Refresh calculations instantly
      const [detRes, predRes] = await Promise.all([
        axios.get(`${API_BASE}/detections`),
        axios.get(`${API_BASE}/predictions`)
      ]);
      setDetections(detRes.data);
      setPredictions(predRes.data);
    } catch (error) {
      console.error("Error submitting feedback:", error);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/settings/email`, emailSettings);
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
      
      // Sync prediction data changes immediately
      const predRes = await axios.get(`${API_BASE}/predictions`);
      setPredictions(predRes.data);
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  };

  const handleToggleTheme = () => {
    const nextTheme = !lightTheme;
    setLightTheme(nextTheme);
    if (nextTheme) {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  };

  const handleStartCamera = async () => {
    try {
      setCameraStatus(prev => ({
        ...prev,
        active: true,
        state: 'validating_camera',
        phase: 'Checking Camera...',
        error: null
      }));
      setStreamCacheBreaker(Date.now());
      await axios.post(`${API_BASE}/camera/start`, { camera_index: selectedCameraId });
      const statusRes = await axios.get(`${API_BASE}/camera/status`);
      setCameraStatus(statusRes.data);
    } catch (error) {
      console.error("Error starting camera thread:", error);
      setCameraStatus(prev => ({
        ...prev,
        active: false,
        state: 'failed',
        error: 'Failed to send activation signal to Flask backend.'
      }));
    }
  };

  const handleStopCamera = async () => {
    try {
      await axios.post(`${API_BASE}/camera/stop`);
      const statusRes = await axios.get(`${API_BASE}/camera/status`);
      setCameraStatus(statusRes.data);
    } catch (error) {
      console.error("Error stopping camera thread:", error);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--md-background)', color: 'var(--md-primary)' }}>
        <h1 style={{ fontFamily: 'var(--font-title)', fontWeight: 800 }}>Loading FarmGuard Console...</h1>
        <p style={{ color: 'var(--md-on-surface-variant)', marginTop: '0.5rem' }}>Initialising prediction engines & datasets</p>
      </div>
    );
  }

  // Next predicted calculations
  const activePredictions = Object.values(predictions)
    .filter(p => p.status === 'success' && p.predicted_time)
    .sort((a, b) => new Date(a.predicted_time) - new Date(b.predicted_time));
    
  const nextArrival = activePredictions[0] || null;

  // Build forecast 30 hour rail
  const buildForecastRail = () => {
    const rail = [];
    const now = new Date();
    for (let i = 1; i <= 30; i++) {
      const slotTime = new Date(now.getTime() + i * 60 * 60 * 1000);
      const slotHour = slotTime.getHours();
      
      let predictedSpecies = null;
      Object.values(predictions).forEach(pred => {
        if (pred.status === 'success' && pred.predicted_time) {
          const predTime = new Date(pred.predicted_time);
          if (predTime.getDate() === slotTime.getDate() && predTime.getHours() === slotHour) {
            predictedSpecies = pred.species;
          }
        }
      });
      
      rail.push({
        label: `${slotHour}:00`,
        time: slotTime,
        predicted: predictedSpecies !== null,
        species: predictedSpecies
      });
    }
    return rail;
  };
  const forecastRail = buildForecastRail();

  // Chart aggregation data
  const speciesCounts = {};
  detections.forEach(d => {
    if (d.status !== 'false_positive') {
      speciesCounts[d.species] = (speciesCounts[d.species] || 0) + 1;
    }
  });
  const pieData = Object.keys(speciesCounts).map((key, idx) => ({
    name: key.replace('_', ' '),
    value: speciesCounts[key]
  }));

  const hourlyCounts = {};
  detections.forEach(d => {
    if (d.status !== 'false_positive') {
      const hr = new Date(d.entry_time).getHours();
      hourlyCounts[hr] = (hourlyCounts[hr] || 0) + 1;
    }
  });
  const barData = Array.from({ length: 24 }).map((_, hr) => ({
    hour: `${hr}:00`,
    intrusions: hourlyCounts[hr] || 0
  })).filter(b => b.intrusions > 0);

  // Statistics calculation - filter by today's date only for the home page counter
  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const todayIntrusions = detections.filter(d => 
    d.status !== 'false_positive' && 
    d.entry_time && d.entry_time.slice(0, 10) === todayStr
  );
  const totalIntrusions = todayIntrusions.length;
  // Use correct field name 'duration_seconds' (not 'duration') from backend API
  const avgDuration = totalIntrusions > 0 
    ? Math.round(todayIntrusions.reduce((acc, curr) => acc + (curr.duration_seconds || 0), 0) / totalIntrusions)
    : 0;
  
  const weatherMode = detections.length > 0 ? detections[0].weather_condition : 'Clear';

  return (
    <div className="dashboard-container">
      {/* BRAND HEADER */}
      <header className="dashboard-header">
        <div className="header-titles">
          <h1>FarmGuard AI Console</h1>
          <p>Real-Time Edge Boundary Intrusion Guard & Automated Risk Forecasting</p>
        </div>
        <div className="header-actions">
          {/* Weather status indicator */}
          <div className="header-btn" style={{ cursor: 'default' }}>
            {weatherMode === 'Rain' && <span>🌧️ Rain</span>}
            {weatherMode === 'Fog' && <span>🌫️ Fog</span>}
            {weatherMode === 'Night' && <span>🌙 Night</span>}
            {weatherMode === 'Clear' && <span>☀️ Clear</span>}
            {!['Rain', 'Fog', 'Night', 'Clear'].includes(weatherMode) && <span>⛅ {weatherMode}</span>}
          </div>
          
          {/* Light/Dark Toggle */}
          <button className="header-btn" onClick={handleToggleTheme}>
            {lightTheme ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                Accessible Light
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                Night Slate Theme
              </>
            )}
          </button>
          
          <button className="header-btn btn-primary" onClick={fetchInitialData}>
            Sync Console
          </button>
        </div>
      </header>

      {/* TOP NAVIGATION TABS */}
      <nav className="nav-tabs">
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          Console Home
        </button>
        
        <button className={`tab-btn ${activeTab === 'detection' ? 'active' : ''}`} onClick={() => setActiveTab('detection')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          Detection Area
        </button>
        
        <button className={`tab-btn ${activeTab === 'prediction' ? 'active' : ''}`} onClick={() => setActiveTab('prediction')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          Forecasting Engine
        </button>
        
        <button className={`tab-btn ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          Alerts Feed
          {notifications.length > 0 && (
            <span className="badge badge-danger" style={{ padding: '0.1rem 0.35rem', fontSize: '0.65rem', marginLeft: '0.25rem' }}>{notifications.length}</span>
          )}
        </button>
        
        <button className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          Analytics Charts
        </button>
        
        <button className={`tab-btn ${activeTab === 'gallery' ? 'active' : ''}`} onClick={() => setActiveTab('gallery')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          Image Gallery
        </button>
        
        <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          Settings
        </button>
      </nav>

      {/* SCREEN TABS */}
      
      {/* 1. OVERVIEW SCREEN */}
      {activeTab === 'dashboard' && (
        <>
          {/* Next arrival forecast banner */}
          {nextArrival ? (
            <div className="panel hero-panel">
              <div className="hero-content">
                <div className="hero-main">
                  <h2>Next Predicted Intrusion Threat</h2>
                  <div className="hero-species">{nextArrival.species.replace('_', ' ')}</div>
                  <div className="hero-time">
                    Predicted: {new Date(nextArrival.predicted_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(nextArrival.predicted_time).toLocaleDateString()})
                  </div>
                  <div className="hero-meta">
                    <span className={`badge ${['elephant', 'wild_boar'].includes(nextArrival.species) ? 'badge-danger' : 'badge-warning'}`}>
                      {['elephant', 'wild_boar'].includes(nextArrival.species) ? '⚠️ CRITICAL RISK' : '⚠️ WARNING RISK'}
                    </span>
                    <span className="badge badge-primary">
                      Window: {nextArrival.peak_activity_window}
                    </span>
                    <span className={`badge ${nextArrival.data_source === 'live' ? 'badge-success' : 'badge-warning'}`}>
                      {nextArrival.data_source === 'live' ? '🛡️ Live Data predictions' : '⚙️ Bootstrap Hybrid calculations'}
                    </span>
                  </div>
                </div>
                <div className="hero-stats">
                  <div className="hero-stat-item">
                    <span className="hero-stat-label">AI confidence</span>
                    <span className="hero-stat-value">{nextArrival.confidence_percentage}%</span>
                  </div>
                  <div className="hero-stat-item" style={{ borderLeft: '1px solid var(--md-outline-variant)', paddingLeft: '2rem' }}>
                    <span className="hero-stat-label">Confirmed logs</span>
                    <span className="hero-stat-value">{nextArrival.live_events_count} / {emailSettings.min_live_events}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel hero-panel" style={{ padding: '2.5rem', textAlign: 'center' }}>
              <h2>Awaiting prediction Data...</h2>
              <p style={{ color: 'var(--md-on-surface-variant)', marginTop: '0.5rem' }}>Start the detection engine to register baseline threat records.</p>
            </div>
          )}

          {/* Core stat cards grid */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon-wrapper">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M12 8v4l3 3"></path></svg>
              </div>
              <div className="stat-info">
                <span className="stat-label">Today's Intrusions</span>
                <span className="stat-value">{totalIntrusions}</span>
                <span className="stat-meta">Active & verified logs (today)</span>
              </div>
            </div>

            <div className={`stat-card ${cameraStatus.active ? 'status-active' : 'status-warning'}`}>
              <div className="stat-icon-wrapper">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              </div>
              <div className="stat-info">
                <span className="stat-label">Active Monitoring Status</span>
                <span className="stat-value">{cameraStatus.active ? 'Monitoring Active' : 'System Standby'}</span>
                <span className="stat-meta">Camera Index #{cameraStatus.camera_index !== -1 ? cameraStatus.camera_index : '—'}</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon-wrapper">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </div>
              <div className="stat-info">
                <span className="stat-label">Average Intrusion Stay</span>
                <span className="stat-value">{avgDuration}s</span>
                <span className="stat-meta">Staying duration average</span>
              </div>
            </div>

            <div className="stat-card status-active">
              <div className="stat-icon-wrapper">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
              </div>
              <div className="stat-info">
                <span className="stat-label">System Health</span>
                <span className="stat-value">100% Online</span>
                <span className="stat-meta">Edge engine connection healthy</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 2. DETECTION AREA SCREEN */}
      {activeTab === 'detection' && (
        <div className="detection-grid">
          {/* Controls & Feeds */}
          <div>
            <div className="panel">
              <h2 className="panel-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                Active Camera stream feed
              </h2>
              
              <div className="camera-wrapper">
                {cameraStatus.active ? (
                  <>
                    <div className="camera-overlay">
                      <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--md-success)', animation: 'pulse 1.5s infinite' }}></span>
                      Live Feed (Camera #{cameraStatus.camera_index})
                    </div>
                    {/* Render live backend video stream */}
                    <img 
                      src={`${API_BASE.replace('/api', '')}/api/camera/feed?cb=${streamCacheBreaker}`} 
                      alt="Boundary Monitor Feed"
                      className="camera-feed"
                      onError={(e) => {
                        console.log("Stream feed loading or closed.");
                      }}
                    />
                  </>
                ) : (
                  <div className="camera-placeholder">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                    <p style={{ fontWeight: 600 }}>Boundary Monitor Stream Offline</p>
                    <span style={{ fontSize: '0.85rem', color: 'var(--md-on-surface-variant)' }}>Start the detection engine to display active feed</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stepper & Selectors */}
          <div>
            <div className="panel">
              <h2 className="panel-title">Edge Device Config</h2>
              
              <div className="form-group">
                <label className="form-label">Select Video Source</label>
                <select 
                  className="form-input" 
                  value={selectedCameraId} 
                  onChange={(e) => setSelectedCameraId(Number(e.target.value))}
                  disabled={cameraStatus.active}
                >
                  {cameraDevices.map(cam => (
                    <option key={cam.id} value={cam.id}>{cam.name} (ID: {cam.id})</option>
                  ))}
                </select>
              </div>

              {cameraStatus.active ? (
                <button className="btn-action-large btn-stop" onClick={handleStopCamera}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>
                  Stop Detection Engine
                </button>
              ) : (
                <button className="btn-action-large btn-start" onClick={handleStartCamera}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Start Detection Engine
                </button>
              )}

              {/* Status stepper */}
              <div style={{ marginTop: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--md-on-surface-variant)', textTransform: 'uppercase', marginBottom: '0.50rem' }}>Diagnostic Checklists</h3>
                <div className="stepper-container">
                  <div className={`stepper-step ${cameraStatus.active && cameraStatus.state === 'validating_camera' ? 'active' : ''} ${cameraStatus.active && cameraStatus.state !== 'validating_camera' && cameraStatus.state !== 'failed' ? 'completed' : ''} ${cameraStatus.state === 'failed' ? 'failed' : ''}`}>
                    <span>🔍</span> Checking camera availability...
                  </div>
                  <div className={`stepper-step ${cameraStatus.active && cameraStatus.state === 'loading_model' ? 'active' : ''} ${cameraStatus.active && ['initializing_tracker', 'opening_camera', 'running'].includes(cameraStatus.state) ? 'completed' : ''}`}>
                    <span>🧠</span> Loading YOLOv8 threat weights...
                  </div>
                  <div className={`stepper-step ${cameraStatus.active && cameraStatus.state === 'running' ? 'active' : ''} ${cameraStatus.active && cameraStatus.state === 'running' ? 'completed' : ''}`}>
                    <span>🛡️</span> Boundary active & monitoring live tracks
                  </div>
                </div>
                {cameraStatus.error && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--md-error-container)', color: 'var(--md-on-error-container)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '12px', fontSize: '0.85rem', fontWeight: 600 }}>
                    Error: {cameraStatus.error}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. FORECASTING & PREDICTIONS SCREEN */}
      {activeTab === 'prediction' && (
        <div>
          {/* Summary */}
          <div className="panel forecast-summary-card">
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--md-on-surface)' }}>Statistical Temporal Prediction System</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--md-on-surface-variant)', marginTop: '0.15rem' }}>
                Transition threshold is currently configured to **{emailSettings.min_live_events} confirmed live detections** per species.
              </p>
            </div>
            <div>
              <span className="badge badge-primary">Mode: {emailSettings.prediction_mode}</span>
            </div>
          </div>

          {/* Predictions Grid */}
          <div className="forecast-grid">
            {Object.entries(predictions).map(([species, data]) => (
              <div className="forecast-card" key={species}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="forecast-species">{species.replace('_', ' ')}</span>
                  <span className={`badge ${data.data_source === 'live' ? 'badge-success' : data.data_source === 'hybrid' ? 'badge-warning' : 'badge-secondary'}`}>
                    {data.data_source}
                  </span>
                </div>
                
                {data.status === 'success' ? (
                  <>
                    <div className="forecast-row" style={{ marginTop: '0.5rem' }}>
                      <span className="gallery-label">Next expected arrival:</span>
                      <span className="gallery-value" style={{ color: 'var(--md-primary)' }}>
                        {new Date(data.predicted_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(data.predicted_time).toLocaleDateString()})
                      </span>
                    </div>
                    <div className="forecast-row">
                      <span className="gallery-label">Peak hour window:</span>
                      <span className="gallery-value">{data.peak_activity_window}</span>
                    </div>
                    <div className="forecast-row">
                      <span className="gallery-label">Statistical confidence:</span>
                      <span className="gallery-value conf" style={{ color: 'var(--md-success)' }}>{data.confidence_percentage}%</span>
                    </div>
                    <div className="forecast-row">
                      <span className="gallery-label">Historical events:</span>
                      <span className="gallery-value">{data.historical_data_points_used} records</span>
                    </div>
                    <div className="forecast-row">
                      <span className="gallery-label">Confirmed live logs:</span>
                      <span className="gallery-value">{data.live_events_count} / {emailSettings.min_live_events}</span>
                    </div>
                    
                    {/* Progress to live transition */}
                    <div style={{ marginTop: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700, color: 'var(--md-on-surface-variant)', marginBottom: '0.25rem' }}>
                        <span>Transition Progress</span>
                        <span>{data.live_events_count} / {emailSettings.min_live_events} logs</span>
                      </div>
                      <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--md-surface-variant)', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.min(100, (data.live_events_count / emailSettings.min_live_events) * 100)}%`, height: '100%', backgroundColor: data.live_events_count >= emailSettings.min_live_events ? 'var(--md-success)' : 'var(--md-primary)', borderRadius: '999px' }}></div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: '1rem 0', textAlign: 'center', color: 'var(--md-on-surface-variant)', fontSize: '0.85rem' }}>
                    ⚠️ {data.message || 'Insufficient data points to make predictions.'}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 30 Hour Forecast Rail */}
          <div className="panel" style={{ marginTop: '1.5rem' }}>
            <h2 className="panel-title">30-Hour Predictive Arrival Rail</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--md-on-surface-variant)' }}>Hourly predictive arrival estimates calculated by historical mode frequencies.</p>
            <div className="timeline-scroll">
              {forecastRail.map((item, idx) => (
                <div key={idx} className={`timeline-card ${item.predicted ? 'predicted' : ''}`}>
                  <span className="timeline-hour">{item.label}</span>
                  {item.predicted ? (
                    <span className="timeline-species">{item.species.substring(0, 8)}</span>
                  ) : (
                    <span style={{ fontSize: '0.65rem', color: 'var(--md-outline)' }}>Safe</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 4. ALERTS SCREEN */}
      {activeTab === 'alerts' && (
        <div className="panel">
          <h2 className="panel-title">Boundary Alerts Log</h2>
          <div style={{ marginTop: '1rem' }}>
            {notifications.length > 0 ? (
              notifications.map((notif) => (
                <div className="alert-feed-row" key={notif.id}>
                  <div className={`alert-feed-status-bar ${notif.confidence > 0.85 ? 'high' : 'medium'}`}></div>
                  <div className="alert-feed-info">
                    <div className="alert-feed-header">
                      <span>⚠️ Threat detection</span>
                      <span className="badge badge-danger" style={{ fontSize: '0.65rem', padding: '0.15rem 0.45rem' }}>
                        {notif.message.split(' ')[1]}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--md-on-surface)', marginTop: '0.25rem' }}>
                      {notif.message} (AI confidence: {(notif.confidence * 100).toFixed(0)}%)
                    </div>
                    <div className="alert-feed-time">Timestamp: {notif.time}</div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: '3rem 0', textTransform: 'uppercase', textAlign: 'center', color: 'var(--md-on-surface-variant)', fontWeight: 600 }}>
                No threats detected today. Boundaries secure.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. ANALYTICS SCREEN */}
      {activeTab === 'analytics' && (
        <div className="analytics-grid">
          <div className="panel">
            <h2 className="panel-title">Species Threat share</h2>
            <div className="chart-container">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--md-on-surface-variant)' }}>No active data available.</div>
              )}
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Hourly intrusion Trends</h2>
            <div className="chart-container">
              {barData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--md-outline-variant)" />
                    <XAxis dataKey="hour" stroke="var(--md-on-surface-variant)" style={{ fontSize: '11px' }} />
                    <YAxis allowDecimals={false} stroke="var(--md-on-surface-variant)" style={{ fontSize: '11px' }} />
                    <Tooltip />
                    <Bar dataKey="intrusions" fill="var(--md-primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--md-on-surface-variant)' }}>No active data available.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. GALLERY & LIVE FEEDBACK SCREEN */}
      {activeTab === 'gallery' && (
        <div className="panel">
          <h2 className="panel-title">Intrusion detection Log & verification</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--md-on-surface-variant)', marginBottom: '1.5rem' }}>
            Verify or correct detections logged by YOLOv8. Verifying these logs updates the statistical forecasting engine in real-time.
          </p>
          
          <div className="gallery-grid">
            {detections.map((det) => (
              <div key={det.id} className="gallery-card">
                <div className="gallery-image-wrapper">
                  {det.brightness_path && det.brightness_path.startsWith('/api/') ? (
                    <img 
                      src={`${API_BASE.replace('/api', '')}${det.brightness_path}`} 
                      alt={det.species} 
                      className="camera-feed"
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="gallery-placeholder" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)', color: '#93c5fd' }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M14.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM9.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 13v3"></path></svg>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#60a5fa' }}>Historical Baseline Data</span>
                    </div>
                  )}
                  <span className={`gallery-card-badge badge ${['elephant', 'wild_boar'].includes(det.species) ? 'badge-danger' : 'badge-warning'}`}>
                    {det.species.replace('_', ' ')}
                  </span>
                  <span className="gallery-card-id">Track #{det.tracker_id}</span>
                </div>
                
                <div className="gallery-details">
                  {det.confirmed === null && (
                    <div className="feedback-prompt" style={{ padding: '0.75rem 1rem', borderRadius: '12px', fontSize: '0.85rem', marginBottom: '0.5rem', fontWeight: 600 }}>
                      Verify classification: **{det.species.replace('_', ' ').toUpperCase()}**?
                    </div>
                  )}

                  <div className="gallery-time">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    {new Date(det.entry_time).toLocaleString()}
                  </div>
                  
                  <div className="gallery-row" style={{ marginTop: '0.25rem' }}>
                    <span className="gallery-label">Stay Duration:</span>
                    <span className="gallery-value">{det.duration} seconds</span>
                  </div>
                  <div className="gallery-row">
                    <span className="gallery-label">Classification Conf:</span>
                    <span className="gallery-value conf">{(det.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="gallery-row">
                    <span className="gallery-label">Log Source:</span>
                    <span className="gallery-value capitalize" style={{ fontSize: '0.8rem' }}>{det.source}</span>
                  </div>
                  <div className="gallery-row">
                    <span className="gallery-label">Review Status:</span>
                    <span className="gallery-value">
                      {det.confirmed === true && <span style={{ color: 'var(--md-success)', fontWeight: 700 }}>✓ Verified</span>}
                      {det.confirmed === null && <span style={{ color: 'var(--md-warning)', fontWeight: 600 }}>? Unreviewed</span>}
                      {det.confirmed === false && <span style={{ color: 'var(--md-error)', fontWeight: 700 }}>✗ Corrected / Invalid</span>}
                    </span>
                  </div>

                  {/* Actions buttons */}
                  {det.confirmed === null && correctingId !== det.id && (
                    <div className="feedback-actions">
                      <button className="btn-action confirm" onClick={() => handleFeedback(det.id, true)}>
                        Confirm Correct
                      </button>
                      <button className="btn-action correct" onClick={() => {
                        setCorrectingId(det.id);
                        setNewSpeciesVal(det.species);
                      }}>
                        Change Species
                      </button>
                      <button className="btn-action false-alarm" onClick={() => handleFeedback(det.id, false, null, true)}>
                        False Alarm
                      </button>
                    </div>
                  )}

                  {/* Change species dropdown inline form */}
                  {correctingId === det.id && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
                      <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.1rem' }}>Select Correct Species:</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <select 
                          className="form-input"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.85rem', flex: 1 }}
                          value={newSpeciesVal}
                          onChange={(e) => setNewSpeciesVal(e.target.value)}
                        >
                          <option value="wild_boar">Wild Boar</option>
                          <option value="elephant">Elephant</option>
                          <option value="macaque">Macaque</option>
                          <option value="nilgai">Nilgai</option>
                        </select>
                        <button className="header-btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => handleFeedback(det.id, false, newSpeciesVal)}>
                          Submit
                        </button>
                        <button className="header-btn" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }} onClick={() => setCorrectingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. SETTINGS CONFIG SCREEN */}
      {activeTab === 'settings' && (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div className="panel">
            <h2 className="panel-title">System Settings & Configurations</h2>
            
            {settingsSuccess && (
              <div className="badge badge-success settings-alert" style={{ width: '100%', justifyContent: 'center', marginBottom: '1.25rem' }}>
                ✓ configurations saved and synced successfully!
              </div>
            )}

            <form onSubmit={handleSaveSettings}>
              <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--md-primary)', borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: '0.5rem' }}>SMTP Email Configuration</h3>
              
              <div className="form-group">
                <label className="form-label">Alert Recipient Email</label>
                <input 
                  type="email" 
                  className="form-input" 
                  value={emailSettings.email}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, email: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.5rem 0' }}>
                <input 
                  type="checkbox" 
                  id="notifications_enabled"
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  checked={emailSettings.enabled}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                />
                <label htmlFor="notifications_enabled" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Email Alerts System</label>
              </div>

              <div className="form-group">
                <label className="form-label">SMTP Username (Gmail/Google Email)</label>
                <input 
                  type="text" 
                  placeholder="e.g. farmguard.alerts@gmail.com"
                  className="form-input" 
                  value={emailSettings.smtp_sender}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_sender: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">SMTP Sender App Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••••••••••"
                  className="form-input" 
                  value={emailSettings.smtp_password}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_password: e.target.value }))}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--md-on-surface-variant)' }}>For Google Gmail, generate an App Password in your account security.</span>
              </div>

              <div className="form-group" style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 2 }}>
                  <label className="form-label">SMTP Host</label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={emailSettings.smtp_host}
                    onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_host: e.target.value }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">SMTP Port</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    value={emailSettings.smtp_port}
                    onChange={(e) => setEmailSettings(prev => ({ ...prev, smtp_port: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', fontWeight: 800, marginTop: '2rem', marginBottom: '1rem', color: 'var(--md-primary)', borderBottom: '1px solid var(--md-outline-variant)', paddingBottom: '0.5rem' }}>Forecasting Settings</h3>

              <div className="form-group">
                <label className="form-label">Prediction mode</label>
                <select 
                  className="form-input"
                  value={emailSettings.prediction_mode}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, prediction_mode: e.target.value }))}
                >
                  <option value="automatic">Automatic Hybrid Transition</option>
                  <option value="live_only">Only Live Confirmed Events</option>
                  <option value="bootstrap_only">Only Bootstrap Seeding Events</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Min Verified Detections for Transition</label>
                <input 
                  type="number" 
                  className="form-input"
                  min="5"
                  max="100"
                  value={emailSettings.min_live_events}
                  onChange={(e) => setEmailSettings(prev => ({ ...prev, min_live_events: Number(e.target.value) }))}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--md-on-surface-variant)' }}>Minimum number of live verified events required to stop using bootstrap fallback baseline.</span>
              </div>

              <button type="submit" className="btn-action-large btn-start" style={{ marginTop: '1.5rem', width: 'auto', paddingLeft: '2rem', paddingRight: '2rem' }}>
                Save Configurations
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default FarmGuard_Dashboard;
