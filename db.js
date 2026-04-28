require('dotenv').config();
const { Pool } = require('pg');

// Use SSL for any non-localhost connection (covers Railway, Render, etc.)
// regardless of NODE_ENV so a missing env var can't break it.
const isLocal = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function initDB() {
  // Run each statement separately — avoids multi-statement pg quirks.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id         SERIAL PRIMARY KEY,
      cat        VARCHAR(20)  NOT NULL,
      label      VARCHAR(100) NOT NULL,
      cls        VARCHAR(200) NOT NULL,
      text       TEXT         NOT NULL,
      lat        DECIMAL(9,6) NOT NULL,
      lng        DECIMAL(9,6) NOT NULL,
      location   VARCHAR(255) NOT NULL DEFAULT 'Unknown',
      confirms   INT          NOT NULL DEFAULT 1,
      helpful    INT          NOT NULL DEFAULT 0,
      outdated   BOOLEAN      NOT NULL DEFAULT false,
      flagged    BOOLEAN      NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_cat        ON posts(cat)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_active     ON posts(outdated, flagged)`);
  console.log('✅ Database ready');
}

// Retry initDB up to 5 times with 3 s gaps — gives Railway's Postgres
// time to be reachable on first deploy.
async function initDBWithRetry(attempts = 5, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await initDB();
      return;
    } catch (err) {
      console.error(`DB init attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error('❌ Could not initialise DB after all retries. API routes will return 500.');
}

module.exports = { pool, initDB: initDBWithRetry };
