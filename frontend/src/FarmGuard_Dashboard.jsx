import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// Configurable backend base URL
const API_BASE = import.meta.env?.VITE_API_BASE || 'http://localhost:8000/api';
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'];

function FarmGuard_Dashboard() {
  const [detections, setDetections] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [emailSettings, setEmailSettings] = useState({ 
    email: 'farmer@example.com', 
    enabled: true,
    prediction_mode: 'automatic'
  });
  const [loading, setLoading] = useState(true);
  
  // Navigation & Theme tabs state
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'detection', 'alerts', 'settings'
  const [lightTheme, setLightTheme] = useState(false);
  // State variables for dynamic camera selection and diagnostics
  const [cameraStatus, setCameraStatus] = useState({
    active: false,
    state: 'idle',
    phase: 'Ready',
    camera_index: -1,
    active_tracks_count: 0,
    error: null
  });
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(-1);

  
  // Gallery reclassification states
  const [correctingId, setCorrectingId] = useState(null);
  const [newSpeciesVal, setNewSpeciesVal] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  
  // Unique cache breaker to reload image stream
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
      
      // Attempt to load settings
      // In Flask, settings are served in the response to settings save,
      // let's preset email settings based on recent mock warning recipients
      if (notifRes.data.length > 0) {
        setEmailSettings(prev => ({
          ...prev,
          email: notifRes.data[0].email || 'farmer@example.com'
        }));
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
      
      const res = await axios.post(`${API_BASE}/feedback/detection/${id}`, payload);
      console.log("Feedback response:", res.data);
      
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
      const res = await axios.post(`${API_BASE}/settings/email`, emailSettings);
      console.log("Settings saved:", res.data);
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
      
      // Sync prediction data changes immediately
      const predRes = await axios.get(`${API_BASE}/predictions`);
      setPredictions(predRes.data);
    } catch (error) {
      console.error("Error saving email settings:", error);
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
      const res = await axios.post(`${API_BASE}/camera/start`, { camera_index: selectedCameraId });
      // Fetch latest state immediately
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
      <div className="loading-screen">
        <h1>Loading FarmGuard Edge Console...</h1>
      </div>
    );
  }

  // Next Arrival Hero Banner calculation
  const activePredictions = Object.values(predictions)
    .filter(p => p.status === 'success' && p.predicted_time)
    .sort((a, b) => new Date(a.predicted_time) - new Date(b.predicted_time));
    
  const nextArrival = activePredictions[0] || null;

  // 30-Hour Forecast Rail data generation
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

  // Chart distributions
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

  // Stats calculation
  const totalIntrusions = detections.filter(d => d.status !== 'false_positive').length;
  const avgDuration = totalIntrusions > 0 
    ? Math.round(detections.filter(d => d.status !== 'false_positive').reduce((acc, curr) => acc + curr.duration, 0) / totalIntrusions)
    : 0;
  const avgBrightness = totalIntrusions > 0
    ? (detections.filter(d => d.status !== 'false_positive').reduce((acc, curr) => acc + (curr.brightness || 0), 0) / totalIntrusions).toFixed(1)
    : '0.0';

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-titles">
          <h1>FarmGuard AI Console</h1>
          <p>Real-Time Edge Animal Intrusion Defense & Predictive Temporal Forecasting</p>
        </div>
        <div className="header-actions">
          {/* Theme switcher */}
          <button className="header-btn" onClick={handleToggleTheme}>
            {lightTheme ? (
              <>
                {/* Moon Icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                Dark Theme
              </>
            ) : (
              <>
                {/* Sun Icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                Light Theme
              </>
            )}
          </button>
          
          {/* Sync action */}
          <button className="header-btn btn-primary" onClick={fetchInitialData}>
            Sync Console
          </button>
        </div>
      </header>

      {/* Top Navigation Tabs */}
      <nav className="nav-tabs">
        <button 
          className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          {/* Home Icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          Console Home
        </button>
        <button 
          className={`tab-btn ${activeTab === 'detection' ? 'active' : ''}`}
          onClick={() => setActiveTab('detection')}
        >
          {/* Camera Icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          Detection Section
        </button>
        <button 
          className={`tab-btn ${activeTab === 'alerts' ? 'active' : ''}`}
          onClick={() => setActiveTab('alerts')}
        >
          {/* Bell Icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          Alerts Feed
          {notifications.length > 0 && (
            <span className="badge badge-danger" style={{ padding: '0.1rem 0.35rem', fontSize: '0.65rem', marginLeft: '0.25rem' }}>{notifications.length}</span>
          )}
        </button>
        <button 
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          {/* Gear Icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          Settings
        </button>
      </nav>

      {/* Main Tab Panels */}
      {activeTab === 'dashboard' && (
        <>
          {/* Next Arrival Hero Card */}
          {nextArrival ? (
            <div className="panel hero-panel">
              <div className="hero-content">
                <div className="hero-main">
                  <h2>Next Predicted Intrusion Arrival (Statistical Mode)</h2>
                  <div className="hero-species">{nextArrival.species.replace('_', ' ')}</div>
                  <div className="hero-time">
                    Expected: {new Date(nextArrival.predicted_time).toLocaleString()}
                  </div>
                  <div className="hero-meta">
                    <span className={`badge ${nextArrival.species === 'elephant' || nextArrival.species === 'wild_boar' ? 'badge-danger' : 'badge-warning'}`}>
                      {nextArrival.species === 'elephant' || nextArrival.species === 'wild_boar' ? '⚠️ CRITICAL RISK' : '⚠️ MEDIUM RISK'}
                    </span>
                    <span className="badge badge-blue">
                      Window: {nextArrival.peak_activity_window}
                    </span>
                    <span className={`badge ${nextArrival.data_source === 'live' ? 'badge-success' : 'badge-secondary'}`}>
                      Data Maturity: {nextArrival.data_source === 'live' ? 'Live Detected' : 'Seeded Baseline'}
                    </span>
                  </div>
                </div>
                <div className="hero-stats">
                  <div className="hero-stat-item">
                    <span className="hero-stat-label">AI Predictability</span>
                    <span className="hero-stat-value" style={{ color: '#60a5fa' }}>{nextArrival.confidence_percentage}%</span>
                  </div>
                  <div className="hero-stat-item">
                    <span className="hero-stat-label">Live Logs Count</span>
                    <span className="hero-stat-value">{nextArrival.live_events_count} / 15</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel hero-panel" style={{ padding: '2rem', textAlign: 'center' }}>
              <h2>No Predicted Arrivals Scheduled</h2>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Awaiting more historical data logs to construct forecasting schedules.</p>
            </div>
          )}

          {/* 30-Hour Forecast Rail */}
          <div className="panel forecast-panel">
            <h2 className="panel-title">
              {/* Calendar Icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              30-Hour Temporal Forecast Timeline (Gap 1)
            </h2>
            <div className="forecast-scroll-container">
              {forecastRail.map((item, idx) => (
                <div key={idx} className={`forecast-rail-card ${item.predicted ? 'predicted' : ''}`}>
                  <div className="forecast-rail-hour">{item.label}</div>
                  <div className="forecast-rail-indicator"></div>
                  {item.predicted && (
                    <div className="forecast-rail-species">{item.species.replace('_', ' ')}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Active Species Forecast Profiles */}
          <div className="panel" style={{ marginBottom: '2rem' }}>
            <h2 className="panel-title">Target Species Predictive Forecast Profiles</h2>
            <div className="prediction-grid">
              {Object.entries(predictions).map(([species, pred]) => (
                <div key={species} className={`pred-panel-item ${pred.status === 'success' && pred.is_within_30h ? 'active-forecast' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <h3 className="capitalize" style={{ fontSize: '1.15rem', fontWeight: '700' }}>{species.replace('_', ' ')}</h3>
                    <span className={`badge ${pred.data_source === 'live' ? 'badge-success' : 'badge-secondary'}`}>
                      Source: {pred.data_source === 'live' ? 'Live Detected' : 'Seed Data'}
                    </span>
                  </div>
                  {pred.status === 'success' ? (
                    <div>
                      <p className="pred-label">Next expected arrival:</p>
                      <p style={{ fontWeight: '700', fontSize: '1rem', color: pred.is_within_30h ? '#3b82f6' : 'var(--text-primary)', marginBottom: '0.75rem' }}>
                        {new Date(pred.predicted_time).toLocaleString()}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        <span>Confidence: <strong>{pred.confidence_percentage}%</strong></span>
                        <span>Live logs: <strong>{pred.live_events_count} / 15</strong></span>
                      </div>
                    </div>
                  ) : (
                    <p className="pred-empty" style={{ margin: 0 }}>Insufficient data logs.</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon-wrapper" style={{ color: '#3b82f6' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              </div>
              <div className="stat-info">
                <h3>Active Intrusions Logged</h3>
                <div className="stat-value" style={{ color: '#3b82f6' }}>{totalIntrusions}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper" style={{ color: '#10b981' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              </div>
              <div className="stat-info">
                <h3>Mean Event Duration</h3>
                <div className="stat-value" style={{ color: '#10b981' }}>{avgDuration}s</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon-wrapper" style={{ color: '#8b5cf6' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
              </div>
              <div className="stat-info">
                <h3>Avg Sensor Brightness</h3>
                <div className="stat-value" style={{ color: '#8b5cf6' }}>{avgBrightness} Lux</div>
              </div>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="analytics-grid">
            <div className="panel">
              <h2 className="panel-title">Intrusion Shares by Species</h2>
              <div className="chart-container">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={95} paddingAngle={5} dataKey="value" label>
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'var(--surface-color)', border: '1px solid var(--surface-border)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                      <Legend formatter={(value) => <span style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>No active chart data.</div>
                )}
              </div>
            </div>

            <div className="panel">
              <h2 className="panel-title">Intrusions Timings (Diurnal Peak)</h2>
              <div className="chart-container">
                {barData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-border)" />
                      <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-secondary)' }} />
                      <Tooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }} contentStyle={{ background: 'var(--surface-color)', border: '1px solid var(--surface-border)', borderRadius: '8px', color: 'var(--text-primary)' }} />
                      <Bar dataKey="intrusions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>No active chart data.</div>
                )}
              </div>
            </div>
          </div>

          {/* Sensor Detection Gallery with Feedback loop */}
          <div className="panel gallery-panel">
            <h2 className="panel-title">
              {/* Eye Icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              Sensor Detection Gallery (Live Feedback Loop & Structured Metadata - No Photo Storage)
            </h2>
            <div className="gallery-grid">
              {detections.map((det) => (
                <div key={det.id} className={`gallery-card ${det.status === 'false_positive' ? 'false_positive' : ''}`}>
                  <div className="gallery-image-wrapper">
                    {/* structured cards render beautiful gradient background with a custom species icon vector (A - No actual photo decision) */}
                    <div className="gallery-placeholder" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)', width: '100%', height: '100%', color: '#93c5fd' }}>
                      {/* Animal Species Graphic Icon */}
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M14.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM9.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 13v3"></path></svg>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#60a5fa' }}>Agricultural Threat Data</span>
                    </div>
                    <span className={`gallery-card-badge badge ${det.species === 'elephant' || det.species === 'wild_boar' ? 'badge-danger' : 'badge-warning'}`}>
                      {det.species.replace('_', ' ')}
                    </span>
                    <span className="gallery-card-id">TID: {det.tracker_id}</span>
                  </div>
                  <div className="gallery-details">
                    {det.confirmed === null && (
                      <div className="feedback-prompt" style={{ 
                        padding: '0.65rem 0.85rem', 
                        background: 'rgba(245, 158, 11, 0.08)', 
                        borderRadius: '10px', 
                        fontSize: '0.85rem', 
                        border: '1px solid rgba(245, 158, 11, 0.2)', 
                        marginBottom: '0.75rem',
                        lineHeight: '1.4'
                      }}>
                        <strong>{det.species.replace('_', ' ').toUpperCase()}</strong> detected &mdash; Track #{det.tracker_id} &mdash; is this correct?
                      </div>
                    )}
                    <div className="gallery-time">
                      {/* Clock Icon */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                      {new Date(det.entry_time).toLocaleString()}
                    </div>
                    <div className="gallery-row">
                      <span className="gallery-label">Duration:</span>
                      <span className="gallery-value">{det.duration}s</span>
                    </div>
                    <div className="gallery-row">
                      <span className="gallery-label">Brightness:</span>
                      <span className="gallery-value capitalize">{det.brightness?.toFixed(1) || '—'} ({det.brightness_path?.replace('_', ' ') || '—'})</span>
                    </div>
                    <div className="gallery-row">
                      <span className="gallery-label">AI Conf:</span>
                      <span className="gallery-value conf">{(det.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div className="gallery-row">
                      <span className="gallery-label">Source Mode:</span>
                      <span className="gallery-value capitalize">{det.source}</span>
                    </div>
                    <div className="gallery-row">
                      <span className="gallery-label">Review Status:</span>
                      <span className="gallery-value">
                        {det.confirmed === true && <span style={{ color: '#10b981', fontWeight: 600 }}>Verified</span>}
                        {det.confirmed === null && <span style={{ color: '#f59e0b', fontWeight: 500 }}>Unreviewed</span>}
                        {det.confirmed === false && <span style={{ color: '#ef4444', fontWeight: 600 }}>Corrected</span>}
                      </span>
                    </div>

                    {/* Reclassify Form */}
                    {correctingId === det.id && (
                      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.25rem' }}>
                        <select 
                          className="form-input" 
                          style={{ flex: 1, padding: '0.25rem', fontSize: '0.8rem' }}
                          value={newSpeciesVal}
                          onChange={(e) => setNewSpeciesVal(e.target.value)}
                        >
                          <option value="">Select correct species...</option>
                          <option value="wild_boar">Wild Boar</option>
                          <option value="elephant">Elephant</option>
                          <option value="macaque">Macaque</option>
                          <option value="nilgai">Nilgai</option>
                        </select>
                        <button 
                          className="header-btn btn-primary" 
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                          onClick={() => handleFeedback(det.id, false, newSpeciesVal)}
                          disabled={!newSpeciesVal}
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Feedback loop actions */}
                  <div className="gallery-actions">
                    <button 
                      className={`feedback-btn confirm ${det.confirmed === true ? 'active-status' : ''}`}
                      title="Verify AI classification"
                      onClick={() => handleFeedback(det.id, true)}
                    >
                      Confirm
                    </button>
                    <button 
                      className="feedback-btn correct"
                      title="Correct animal species classification"
                      onClick={() => setCorrectingId(det.id)}
                    >
                      Correct
                    </button>
                    <button 
                      className="feedback-btn delete"
                      title="Flag as false positive"
                      onClick={() => handleFeedback(det.id, false, null, true)}
                    >
                      False Alarm
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === 'detection' && (
        <div className="camera-card">
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>AI Detection & Boundary Tracking Console</h2>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
              Launch dynamic YOLOv8 object tracking in a native hardware-accelerated window.
            </p>
          </div>

          {/* Camera Selection Dropdown */}
          <div className="form-group" style={{ maxWidth: '500px', margin: '0 auto 2rem auto' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '700', fontSize: '0.95rem' }}>
              Select Capture Source:
            </label>
            <select 
              className="form-input" 
              style={{ padding: '0.75rem 1rem', width: '100%', fontSize: '1rem', borderRadius: '10px' }}
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(Number(e.target.value))}
              disabled={cameraStatus.active && cameraStatus.state !== 'failed'}
            >
              {cameraDevices.map((cam) => (
                <option key={cam.id} value={cam.id}>{cam.name}</option>
              ))}
            </select>
          </div>

          {/* Operational Status Display Board */}
          <div className="camera-stream-wrapper" style={{ minHeight: '260px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            
            {/* Case 1: IDLE / OFFLINE */}
            {!cameraStatus.active && cameraStatus.state !== 'failed' && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '1.25rem', opacity: 0.6 }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                <p style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>System Camera Interface Offline</p>
                <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', maxWidth: '400px', margin: '0.5rem auto 0 auto' }}>
                  Starting the engine will open the live tracking feed inside a dedicated high-performance desktop window.
                </p>
              </div>
            )}

            {/* Case 2: LOADING DIAGNOSTICS */}
            {cameraStatus.active && ['validating_camera', 'loading_model', 'initializing_tracker', 'opening_camera'].includes(cameraStatus.state) && (
              <div style={{ textAlign: 'center', width: '100%', maxWidth: '400px' }}>
                {/* Pulsing loading ring */}
                <div className="loading-spinner-glow" style={{ margin: '0 auto 1.5rem auto' }}></div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.75rem' }}>Initializing AI Engine</h3>
                
                {/* Progress bar stages */}
                <div style={{ background: 'var(--surface-border)', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '1rem' }}>
                  <div 
                    className="progress-fill-anim"
                    style={{ 
                      height: '100%', 
                      background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                      width: 
                        cameraStatus.state === 'validating_camera' ? '25%' :
                        cameraStatus.state === 'loading_model' ? '50%' :
                        cameraStatus.state === 'initializing_tracker' ? '75%' : '90%'
                    }}
                  ></div>
                </div>
                <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#60a5fa' }} className="capitalize">
                  {cameraStatus.phase}
                </p>
              </div>
            )}

            {/* Case 3: ACTIVE MONITORING */}
            {cameraStatus.active && cameraStatus.state === 'running' && (
              <div style={{ textAlign: 'center', width: '100%' }}>
                <div className="status-radar-glow" style={{ margin: '0 auto 1.25rem auto' }}></div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <span className="status-dot active animate-ping"></span>
                  NATIVE TRACKING ACTIVE
                </h3>
                <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', marginTop: '0.5rem', maxWidth: '500px', margin: '0.5rem auto 1.5rem auto' }}>
                  The border detection viewport has loaded on your desktop. Bounding boxes and tracker logs are being drawn in real-time.
                </p>

                {/* Telemetry metadata stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', maxWidth: '600px', margin: '0 auto' }}>
                  <div className="panel" style={{ padding: '1rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Target Device</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem' }}>#{cameraStatus.camera_index}</div>
                  </div>
                  <div className="panel" style={{ padding: '1rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Active Tracks</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem', color: '#10b981' }}>{cameraStatus.active_tracks_count}</div>
                  </div>
                  <div className="panel" style={{ padding: '1rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Status</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.25rem', color: '#60a5fa' }}>Processing</div>
                  </div>
                </div>
              </div>
            )}

            {/* Case 4: ENGINE FAILURE / STATE ERROR */}
            {cameraStatus.state === 'failed' && (
              <div style={{ textAlign: 'center', maxWidth: '500px' }}>
                <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" style={{ marginBottom: '1.25rem' }}><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f87171', marginBottom: '0.5rem' }}>Engine Initialization Failed</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', background: 'rgba(239,68,68,0.05)', padding: '0.75rem 1.25rem', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.15)', marginBottom: '1.5rem' }}>
                  {cameraStatus.error || "An unknown hardware or driver conflict was encountered while attempting to open the stream."}
                </p>
                <button 
                  className="header-btn" 
                  style={{ padding: '0.6rem 1.5rem', background: 'var(--surface-color)', border: '1px solid var(--surface-border)' }}
                  onClick={() => setCameraStatus({ active: false, state: 'idle', phase: 'Ready', error: null, camera_index: -1, active_tracks_count: 0 })}
                >
                  Clear Status & Retry
                </button>
              </div>
            )}

          </div>

          {/* Trigger Control Actions */}
          <div style={{ display: 'flex', gap: '1.25rem', justifyContent: 'center', marginTop: '2rem' }}>
            <button 
              className="header-btn btn-primary" 
              style={{ padding: '0.85rem 3rem', fontSize: '1.05rem', fontWeight: '600', borderRadius: '10px' }}
              onClick={handleStartCamera}
              disabled={cameraStatus.active && cameraStatus.state !== 'failed'}
            >
              Start Detection Engine
            </button>
            <button 
              className="header-btn" 
              style={{ 
                padding: '0.85rem 3rem', 
                fontSize: '1.05rem', 
                fontWeight: '600', 
                borderRadius: '10px', 
                background: 'var(--danger-glow)', 
                color: '#fca5a5', 
                borderColor: 'rgba(239,68,68,0.2)' 
              }}
              onClick={handleStopCamera}
              disabled={!cameraStatus.active || cameraStatus.state === 'failed'}
            >
              Stop Detection Engine
            </button>
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="panel" style={{ width: '100%' }}>
          <h2 className="panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            Onsite Live alerts feed
          </h2>
          <div className="notification-list" style={{ maxHeight: 'none', overflowY: 'visible' }}>
            {notifications.map((notif) => (
              <div key={notif.id} className="notification-item" style={{ 
                borderLeft: notif.brightness_path === 'warning' ? '6px solid var(--warning-color)' : '6px solid var(--danger-color)',
                background: notif.brightness_path === 'warning' ? 'var(--warning-glow)' : 'rgba(239,68,68,0.02)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="notification-text" style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                    {notif.message}
                  </div>
                  <span className="badge badge-secondary">{notif.time}</span>
                </div>
                <div className="notification-meta" style={{ marginTop: '0.5rem' }}>
                  <span className={`badge ${notif.brightness_path === 'warning' ? 'badge-warning' : 'badge-danger'}`}>
                    {notif.brightness_path === 'warning' ? 'PREDICTIVE' : 'CRITICAL'}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    AI Confidence: <strong>{(notif.confidence * 100).toFixed(0)}%</strong>
                  </span>
                  {notif.email_sent && (
                    <span style={{ color: 'var(--success-color)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                      📧 Dispatched to alert email
                    </span>
                  )}
                </div>
              </div>
            ))}
            {notifications.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                No active boundaries warnings logged yet.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="panel" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 className="panel-title">FarmGuard Console Settings Manager</h2>
          <form onSubmit={handleSaveSettings} className="settings-form">
            <div className="form-group">
              <label>Notification Email Address</label>
              <input 
                type="email" 
                className="form-input" 
                value={emailSettings.email}
                onChange={(e) => setEmailSettings({ ...emailSettings, email: e.target.value })}
                required
              />
            </div>
            <div className="toggle-wrapper">
              <input 
                type="checkbox" 
                id="enableAlerts"
                checked={emailSettings.enabled}
                onChange={(e) => setEmailSettings({ ...emailSettings, enabled: e.target.checked })}
              />
              <label htmlFor="enableAlerts" style={{ userSelect: 'none' }}>Enable Instant Email Warning Alerts</label>
            </div>

            {/* Shift option - toggling calculation data Mode (automatic vs seed vs live) */}
            <div className="form-group" style={{ marginTop: '1.25rem' }}>
              <label htmlFor="predictionMode">Prediction DataSource Strategy (Shift Option)</label>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                Configure forecasting data inputs to switch dynamically or use explicit pools.
              </p>
              <select 
                id="predictionMode"
                className="form-input"
                value={emailSettings.prediction_mode}
                onChange={(e) => setEmailSettings({ ...emailSettings, prediction_mode: e.target.value })}
              >
                <option value="automatic">Automatic Hybrid (Switch over at 15 live events)</option>
                <option value="seed_only">Baseline Seed Data Only (Ignore live logs)</option>
                <option value="live_only">Live Detected Data Only (Ignore Seed fallbacks)</option>
              </select>
            </div>

            <button type="submit" className="header-btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: '1.5rem' }}>
              Save Settings Configuration
            </button>
            {settingsSuccess && <div className="success-msg" style={{ marginTop: '1rem' }}>Settings and prediction data strategy saved successfully!</div>}
          </form>
        </div>
      )}

    </div>
  );
}

export default FarmGuard_Dashboard;
