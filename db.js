require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
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
    );

    CREATE INDEX IF NOT EXISTS idx_posts_cat        ON posts(cat);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_active     ON posts(outdated, flagged);
  `);
  console.log('✅ Database ready');
}

module.exports = { pool, initDB };
