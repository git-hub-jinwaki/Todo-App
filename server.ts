import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('minutes.db');

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS minutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    summary TEXT,
    format TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    minute_id INTEGER,
    task_text TEXT,
    assignee TEXT,
    due_date TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(minute_id) REFERENCES minutes(id)
  );
`);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get('/api/minutes', (req, res) => {
    const rows = db.prepare('SELECT * FROM minutes ORDER BY created_at DESC').all();
    res.json(rows);
  });

  app.post('/api/minutes', (req, res) => {
    const { title, content, summary, format, tasks } = req.body;
    const info = db.prepare('INSERT INTO minutes (title, content, summary, format) VALUES (?, ?, ?, ?)').run(title, content, summary, format);
    const minuteId = info.lastInsertRowid;

    if (tasks && Array.isArray(tasks)) {
      const insertTask = db.prepare('INSERT INTO tasks (minute_id, task_text, assignee, due_date) VALUES (?, ?, ?, ?)');
      for (const task of tasks) {
        insertTask.run(minuteId, task.text, task.assignee, task.dueDate);
      }
    }

    res.json({ id: minuteId });
  });

  app.get('/api/tasks', (req, res) => {
    const rows = db.prepare(`
      SELECT tasks.*, minutes.title as minute_title 
      FROM tasks 
      JOIN minutes ON tasks.minute_id = minutes.id 
      ORDER BY tasks.created_at DESC
    `).all();
    res.json(rows);
  });

  app.post('/api/tasks', (req, res) => {
    const { minute_id, task_text, assignee, due_date } = req.body;
    const info = db.prepare('INSERT INTO tasks (minute_id, task_text, assignee, due_date) VALUES (?, ?, ?, ?)').run(minute_id, task_text, assignee, due_date);
    res.json({ id: info.lastInsertRowid });
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true });
  });

  app.get('/api/search', (req, res) => {
    const { q } = req.query;
    const rows = db.prepare('SELECT * FROM minutes WHERE title LIKE ? OR summary LIKE ? OR content LIKE ?').all(`%${q}%`, `%${q}%`, `%${q}%`);
    res.json(rows);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
