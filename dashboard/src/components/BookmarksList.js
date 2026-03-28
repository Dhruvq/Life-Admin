import React, { useEffect, useState } from 'react';
import './List.css'; 

function BookmarksList() {
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const fetchData = () => {
      fetch('http://localhost:3002/api/bookmarks')
        .then((res) => res.json())
        .then((data) => {
          setBookmarks(Array.isArray(data) ? data : []);
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

  if (loading) return <div className="loading">Loading bookmarks...</div>;

  return (
    <div className="list-container">
      <div className="section-header">
        <h2>📌 Bookmarks</h2>
        <span className="badge">{bookmarks.length}</span>
      </div>
      {bookmarks.length === 0 ? (
        <div className="empty-state">No bookmarks found. Add some by messaging the agent!</div>
      ) : (
        <div className="stacked-list">
          {bookmarks.map((b) => {
            let parsedTags = [];
            try { parsedTags = JSON.parse(b.tags); } catch(e) {}
            const isExpanded = expandedId === b.id;
            
            return (
              <div 
                key={b.id} 
                className={`card accordion-card bookmark-card ${isExpanded ? 'expanded' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : b.id)}
              >
                <div className="card-header">
                  <h3>{b.item}</h3>
                  <div className={`expand-indicator ${isExpanded ? 'rotated' : ''}`}>
                    ▼
                  </div>
                </div>
                
                {isExpanded && (
                  <div className="card-details fade-down">
                    {b.context && <p className="card-context">{b.context}</p>}
                    <div className="card-footer">
                      <span className="date">{new Date(b.created_at).toLocaleDateString()}</span>
                      <div className="tags">
                        <span className="tag sender-tag">👤 {b.sender || 'Me'}</span>
                        {parsedTags.map(tag => <span key={tag} className="tag">{tag}</span>)}
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

export default BookmarksList;
