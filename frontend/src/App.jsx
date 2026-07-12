import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

const API_BASE = 'http://localhost:8000/api';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function App() {
  const [analytics, setAnalytics] = useState(null);
  const [events, setEvents] = useState([]);
  const [predictions, setPredictions] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [analyticsRes, eventsRes] = await Promise.all([
        axios.get(`${API_BASE}/analytics/summary`),
        axios.get(`${API_BASE}/events?limit=10`)
      ]);
      
      setAnalytics(analyticsRes.data);
      setEvents(eventsRes.data);
      
      // Fetch predictions for top species
      const speciesList = Object.keys(analyticsRes.data.species_breakdown || {});
      const preds = {};
      for (const sp of speciesList) {
        const predRes = await axios.get(`${API_BASE}/predict/${sp}`);
        preds[sp] = predRes.data;
      }
      setPredictions(preds);
      
    } catch (error) {
      console.error("Error fetching data", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading-screen"><h1>Initializing AI Core...</h1></div>;
  }

  // Format data for charts
  const pieData = analytics ? Object.keys(analytics.species_breakdown).map(key => ({
    name: key,
    value: analytics.species_breakdown[key]
  })) : [];

  const barData = analytics ? Object.keys(analytics.hourly_distribution).map(hour => ({
    hour: `${hour}:00`,
    intrusions: analytics.hourly_distribution[hour]
  })) : [];

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-titles">
          <h1>AI Wildlife Intrusion System</h1>
          <p>Proactive agricultural protection and prediction engine</p>
        </div>
        <button onClick={fetchData} className="refresh-btn">
          Refresh Data
        </button>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <h2>Total Intrusions</h2>
          <p className="stat-value blue-text">{analytics?.total_intrusions}</p>
        </div>
        <div className="stat-card">
          <h2>Avg. Duration</h2>
          <p className="stat-value green-text">{analytics?.avg_duration_seconds} sec</p>
        </div>
        <div className="stat-card">
          <h2>Tracked Species</h2>
          <p className="stat-value purple-text">{Object.keys(analytics?.species_breakdown || {}).length}</p>
        </div>
      </div>

      <div className="main-grid">
        {/* Prediction Cards */}
        <div className="panel full-width prediction-panel">
          <h2 className="panel-title">Future Intrusion Predictions (AI Forecast)</h2>
          <div className="prediction-grid">
            {Object.entries(predictions).map(([species, pred]) => (
              <div key={species} className={`prediction-card ${pred.confidence_percentage > 80 ? 'high-alert' : 'medium-alert'}`}>
                <h3 className="species-name">{species.replace('_', ' ')}</h3>
                {pred.status === 'success' ? (
                  <>
                    <p className="pred-label">Predicted Next Arrival:</p>
                    <p className="pred-time">{new Date(pred.predicted_time).toLocaleString()}</p>
                    <div className="pred-footer">
                      <span>Confidence:</span>
                      <span className="pred-confidence">{pred.confidence_percentage}%</span>
                    </div>
                  </>
                ) : (
                  <p className="pred-empty">Insufficient historical data to forecast.</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Charts */}
        <div className="panel chart-panel">
          <h2 className="panel-title">Intrusions by Species</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" label>
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel chart-panel">
          <h2 className="panel-title">Activity by Hour (Temporal Profile)</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="hour" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: '#f3f4f6'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="intrusions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Dataset Repository / Recent Logs */}
      <div className="panel">
        <h2 className="panel-title">Recent Intrusion Log (Dataset Repository)</h2>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Species</th>
                <th>Entry Time</th>
                <th>Duration</th>
                <th>AI Confidence</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>#{event.id}</td>
                  <td className="capitalize font-medium">{event.species.replace('_', ' ')}</td>
                  <td>{new Date(event.entry_time).toLocaleString()}</td>
                  <td>{event.duration}s</td>
                  <td>{(event.confidence * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

export default App;
