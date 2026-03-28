const express = require('express');
const cors = require('cors');
const path = require('path');

const Database = require('better-sqlite3');

// Read directly from the DB so we can globally fetch items for all users
const db = new Database(path.join(__dirname, '../life-admin.db'), { readonly: true });

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// GET all bookmarks
app.get('/api/bookmarks', (req, res) => {
  try {
    const bookmarks = db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all();
    res.json(bookmarks);
  } catch (error) {
    console.error('Error fetching bookmarks:', error);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// GET all reminders
app.get('/api/reminders', (req, res) => {
  try {
    const reminders = db.prepare("SELECT * FROM reminders ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, remind_at ASC").all();
    res.json(reminders);
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard backend running on http://localhost:${PORT}`);
});
