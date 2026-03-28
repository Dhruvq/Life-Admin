import React from 'react';
import BookmarksList from './BookmarksList';
import RemindersList from './RemindersList';
import './Dashboard.css';

function Dashboard() {
  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-title">
            <h1>Life Admin</h1>
            <p className="subtitle">Your intelligent memory and proactive assistant</p>
          </div>
        </div>
      </header>
      
      <main className="dashboard-main">
        <div className="split-view">
          <section className="column left-column">
            <BookmarksList />
          </section>
          <section className="column right-column">
            <RemindersList />
          </section>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;