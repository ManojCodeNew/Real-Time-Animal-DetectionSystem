import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

// Configurable backend base URL (Constant with fallback to environment variables)
const API_BASE = import.meta.env?.VITE_API_BASE || 'http://localhost:8000/api';
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'];

function FarmGuard_Dashboard() {
  const [detections, setDetections] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [emailSettings, setEmailSettings] = useState({ email: 'farmer@example.com', enabled: true });
  const [loading, setLoading] = useState(true);
  
  // UI states
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [correctingId, setCorrectingId] = useState(null);
  const [newSpeciesVal, setNewSpeciesVal] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  
  useEffect(() => {
    // 1. Initial Fetch
    fetchInitialData();
    
    // 2. Live Polling: Poll detections, notifications, and forecasts every 5 seconds
    const pollInterval = setInterval(async () => {
      try {
        const [detRes, notifRes, predRes] = await Promise.all([
          axios.get(`${API_BASE}/detections`),
          axios.get(`${API_BASE}/notifications`),
          axios.get(`${API_BASE}/predictions`)
        ]);
        setDetections(detRes.data);
        setNotifications(notifRes.data);
        setPredictions(predRes.data);
      } catch (error) {
        console.error("Error polling real-time events:", error);
      }
    }, 5000);
    
    return () => clearInterval(pollInterval);
  }, []);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const [detRes, predRes, notifRes] = await Promise.all([
        axios.get(`${API_BASE}/detections`),
        axios.get(`${API_BASE}/predictions`),
        axios.get(`${API_BASE}/notifications`)
      ]);
      setDetections(detRes.data);
      setPredictions(predRes.data);
      setNotifications(notifRes.data);
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
      
      // Reset correction UI state
      setCorrectingId(null);
      setNewSpeciesVal('');
      
      // Refresh predictions and logs instantly
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
    } catch (error) {
      console.error("Error saving email settings:", error);
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
          <p>Real-Time Edge Animal Intrusion Defense & Forecasting (Live API Feed)</p>
        </div>
        <div className="header-actions">
          <button className="header-btn" onClick={() => setShowNotifications(true)}>
            {/* Bell Icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            Alerts
            {notifications.length > 0 && (
              <span className="badge badge-danger" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}>{notifications.length}</span>
            )}
          </button>
          <button className="header-btn" onClick={() => setShowSettings(true)}>
            {/* Gear Icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            Settings
          </button>
          <button className="header-btn btn-primary" onClick={fetchInitialData}>
            Sync Console
          </button>
        </div>
      </header>

      {/* Next Arrival Hero Card */}
      {nextArrival ? (
        <div className="panel hero-panel">
          <div className="hero-content">
            <div className="hero-main">
              <h2>Immediate Next Forecasted Arrival</h2>
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
                <span className={`badge ${nextArrival.data_maturity === 'live' ? 'badge-success' : 'badge-secondary'}`}>
                  Data Maturity: {nextArrival.data_maturity === 'live' ? 'Empirical/Live' : 'Baseline/Seed'}
                </span>
              </div>
            </div>
            <div className="hero-stats">
              <div className="hero-stat-item">
                <span className="hero-stat-label">AI Confidence</span>
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
          30-Hour Temporal Forecast Timeline
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

      {/* Active Species Forecast Profiles (Phase 6 Forecast Cards) */}
      <div className="panel" style={{ marginBottom: '2rem' }}>
        <h2 className="panel-title">Target Species Predictive Forecast Profiles</h2>
        <div className="prediction-grid">
          {Object.entries(predictions).map(([species, pred]) => (
            <div key={species} className={`pred-panel-item ${pred.status === 'success' && pred.is_within_30h ? 'active-forecast' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <h3 className="capitalize" style={{ fontSize: '1.15rem', fontWeight: '700' }}>{species.replace('_', ' ')}</h3>
                <span className={`badge ${pred.data_maturity === 'live' ? 'badge-success' : 'badge-secondary'}`}>
                  Maturity: {pred.data_maturity === 'live' ? 'Live' : 'Seed'}
                </span>
              </div>
              {pred.status === 'success' ? (
                <div>
                  <p className="pred-label">Next predicted arrival:</p>
                  <p style={{ fontWeight: '700', fontSize: '1rem', color: pred.is_within_30h ? '#60a5fa' : 'var(--text-primary)', marginBottom: '0.75rem' }}>
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
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#f3f4f6' }} />
                  <Legend formatter={(value) => <span style={{ color: '#f3f4f6', textTransform: 'capitalize' }}>{value}</span>} />
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af' }} />
                  <Tooltip cursor={{ fill: 'rgba(255,255,255,0.02)' }} contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#f3f4f6' }} />
                  <Bar dataKey="intrusions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>No active chart data.</div>
            )}
          </div>
        </div>
      </div>

      {/* Detection Gallery with Feedback loop */}
      <div className="panel gallery-panel">
        <h2 className="panel-title">
          {/* Eye Icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          Sensor Detection Gallery (Live Feedback Loop)
        </h2>
        <div className="gallery-grid">
          {detections.map((det) => (
            <div key={det.id} className={`gallery-card ${det.status === 'false_positive' ? 'false_positive' : ''}`}>
              <div className="gallery-image-wrapper">
                {det.image_url ? (
                  <img src={det.image_url} alt={det.species} className="gallery-image" />
                ) : (
                  <div className="gallery-placeholder">
                    {/* Animal Placeholder Icon */}
                    <svg className="gallery-placeholder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M14.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM9.5 9.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 13v3"></path></svg>
                    <span>Headless Crop Archive</span>
                  </div>
                )}
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
                  <span className="gallery-label">Review Status:</span>
                  <span className="gallery-value">
                    {det.confirmed === true && <span style={{ color: '#10b981', fontWeight: 600 }}>Verified</span>}
                    {det.confirmed === null && <span style={{ color: '#f59e0b', fontWeight: 500 }}>Unreviewed</span>}
                    {det.confirmed === false && <span style={{ color: '#ef4444', fontWeight: 600 }}>Corrected</span>}
                  </span>
                </div>

                {/* Inline Reclassify Form */}
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

              {/* Feedback controls */}
              <div className="gallery-actions">
                <button 
                  className={`feedback-btn confirm ${det.confirmed === true ? 'active-status' : ''}`}
                  title="Verify AI detection is correct"
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
                  title="Flag as false positive (camera glitch/wind)"
                  onClick={() => handleFeedback(det.id, false, null, true)}
                >
                  False Alarm
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notifications Slideout Overlay */}
      {showNotifications && (
        <div className="slideout-overlay" onClick={() => setShowNotifications(false)}>
          <div className="slideout-content" onClick={(e) => e.stopPropagation()}>
            <div className="slideout-header">
              <h2>Live Alerts Feed</h2>
              <button className="close-btn" onClick={() => setShowNotifications(false)}>&times;</button>
            </div>
            <div className="notification-list">
              {notifications.map((notif) => (
                <div key={notif.id} className="notification-item">
                  <div className="notification-text">{notif.message}</div>
                  <div className="notification-time">{notif.time}</div>
                  <div className="notification-meta">
                    <span className="badge badge-danger">High Risk</span>
                    {notif.email_sent && <span style={{ color: '#10b981', fontSize: '0.8rem' }}>📧 Email Sent</span>}
                  </div>
                </div>
              ))}
              {notifications.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>No live intrusion warnings.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Slideout Overlay */}
      {showSettings && (
        <div className="slideout-overlay" onClick={() => setShowSettings(false)}>
          <div className="slideout-content" onClick={(e) => e.stopPropagation()}>
            <div className="slideout-header">
              <h2>Settings Manager</h2>
              <button className="close-btn" onClick={() => setShowSettings(false)}>&times;</button>
            </div>
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
                <label htmlFor="enableAlerts" style={{ userSelect: 'none' }}>Enable Instant Email Warnings</label>
              </div>
              <button type="submit" className="header-btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: '1rem' }}>
                Save Settings
              </button>
              {settingsSuccess && <div className="success-msg">Settings saved! Alerts log updated.</div>}
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export default FarmGuard_Dashboard;
