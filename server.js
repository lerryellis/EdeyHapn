require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { pool, initDB } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Health ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── GET /api/posts ────────────────────────────────────────────────
app.get('/api/posts', async (req, res) => {
  try {
    const { cat } = req.query;
    const params  = [];
    let where     = 'WHERE outdated = false';

    if (cat && cat !== 'all') {
      params.push(cat);
      where += ` AND cat = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT * FROM posts ${where} ORDER BY created_at DESC LIMIT 100`,
      params
    );
    res.json({ posts: result.rows });
  } catch (err) {
    console.error('GET /api/posts', err.message);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// ── POST /api/posts ───────────────────────────────────────────────
app.post('/api/posts', async (req, res) => {
  try {
    const { cat, label, cls, text, lat, lng, location } = req.body;
    if (!cat || !text || lat == null || lng == null) {
      return res.status(400).json({ error: 'cat, text, lat and lng are required' });
    }
    const result = await pool.query(
      `INSERT INTO posts (cat, label, cls, text, lat, lng, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [cat, label || cat, cls || '', text.trim(), parseFloat(lat), parseFloat(lng), location || 'Unknown']
    );
    res.status(201).json({ post: result.rows[0] });
  } catch (err) {
    console.error('POST /api/posts', err.message);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// ── PATCH /api/posts/:id/confirm ──────────────────────────────────
app.patch('/api/posts/:id/confirm', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE posts SET confirms = confirms + 1 WHERE id = $1 RETURNING id, confirms',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to confirm' });
  }
});

// ── PATCH /api/posts/:id/helpful ─────────────────────────────────
app.patch('/api/posts/:id/helpful', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE posts SET helpful = helpful + 1 WHERE id = $1 RETURNING id, helpful',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Post not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark helpful' });
  }
});

// ── PATCH /api/posts/:id/outdated ────────────────────────────────
app.patch('/api/posts/:id/outdated', async (req, res) => {
  try {
    await pool.query('UPDATE posts SET outdated = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark outdated' });
  }
});

// ── PATCH /api/posts/:id/flag ─────────────────────────────────────
app.patch('/api/posts/:id/flag', async (req, res) => {
  try {
    await pool.query('UPDATE posts SET flagged = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to flag post' });
  }
});

// ── Catch-all → serve frontend ────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────
// HTTP server starts first so Railway health checks pass immediately.
// DB init runs after — if it fails the app stays up and API routes
// return 500 until the connection is available.
app.listen(PORT, () => {
  console.log(`🚀 EdeyHapn running on http://localhost:${PORT}`);
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? 'set ✓' : 'NOT SET ✗ — check Railway variables'}`);

  initDB().catch(err => {
    console.error('⚠️  DB init failed (API routes will return 500 until fixed):', err.message);
  });
});
