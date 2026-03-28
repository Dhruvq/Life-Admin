import React, { useState, useEffect } from 'react';
import MessageLog from './MessageLog';
import './Dashboard.css';

const Dashboard = () => {
  const getTodayString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [messages, setMessages] = useState([]);
  const [filterDate, setFilterDate] = useState(getTodayString());

  const fetchMessages = () => {
    fetch('http://localhost:3001/messages')
      .then((res) => res.json())
      .then((data) => setMessages(data))
      .catch((error) => console.error('Failed to fetch messages:', error));
  };

  useEffect(() => {
    fetchMessages(); // Run once initially
    const interval = setInterval(fetchMessages, 2000); // Poll every 2 seconds
    return () => clearInterval(interval); // Cleanup on component unmount
  }, []);


  const filteredMessages = messages.filter((message) => {
    if (!filterDate) return true;
    
    // filterDate is in "YYYY-MM-DD" format.
    // We convert the message timestamp to the local "YYYY-MM-DD" string to compare properly
    // without suffering from UTC parsing timezone offset bugs.
    const d = new Date(message.timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const localMessageDate = `${year}-${month}-${day}`;
    
    return localMessageDate === filterDate;
  });

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Agent Logs</h1>
        <div className="controls">
          <input 
            className="date-filter" 
            type="date" 
            value={filterDate} 
            onChange={(e) => setFilterDate(e.target.value)} 
          />
          <a 
            href="sms:+18587057178?body=Hello%20Agent!" 
            className="add-button"
            style={{ textDecoration: 'none' }}
          >
            Connect via iMessage
          </a>
        </div>
      </div>
      <MessageLog messages={filteredMessages} />
    </div>
  );
};

export default Dashboard;