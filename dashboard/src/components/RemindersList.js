import React, { useEffect, useState } from 'react';
import './List.css'; 

function RemindersList() {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const fetchData = () => {
      fetch('http://localhost:3002/api/reminders')
        .then((res) => res.json())
        .then((data) => {
          setReminders(Array.isArray(data) ? data : []);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    };

    fetchData(); // Initial fetch
    const interval = setInterval(fetchData, 3000); // Poll every 3 seconds

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  if (loading) return <div className="loading">Loading reminders...</div>;

  return (
    <div className="list-container">
      <div className="section-header">
        <h2>⏰ Reminders</h2>
        <span className="badge">{reminders.length}</span>
      </div>
      {reminders.length === 0 ? (
        <div className="empty-state">No upcoming reminders. You're all caught up!</div>
      ) : (
        <div className="stacked-list">
          {reminders.map((r) => {
            let parsedTags = [];
            try { parsedTags = JSON.parse(r.entity_tags); } catch(e) {}
            const isSent = r.status === 'sent';
            const isExpanded = expandedId === r.id;
            
            return (
              <div 
                key={r.id} 
                className={`card accordion-card reminder-card urgency-${r.urgency} ${isSent ? 'sent' : ''} ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : r.id)}
              >
                <div className="card-header">
                  <div className="header-left">
                    <h3>{r.task}</h3>
                    <span className={`status-badge ${r.status}`}>{r.status}</span>
                  </div>
                  <div className={`expand-indicator ${isExpanded ? 'rotated' : ''}`}>
                    ▼
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="card-details fade-down">
                    <div className="remind-time">
                      <span className="time-icon">🕒</span> {new Date(r.remind_at).toLocaleString()}
                    </div>
                    <div className="card-footer">
                      <span className={`urgency-badge ${r.urgency}`}>{r.urgency}</span>
                      <div className="tags">
                        <span className="tag sender-tag">👤 {r.sender || 'Me'}</span>
                        {parsedTags.map(tag => <span key={tag} className="tag">🔗 {tag}</span>)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RemindersList;
