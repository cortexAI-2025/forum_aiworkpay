import { readFileSync } from 'node:fs';

const { Client } = await import('pg');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(readFileSync(new URL('../schema-postgres.sql', import.meta.url), 'utf8'));
  // Seed from the same welcome text as SQLite, keeping the public API unchanged.
  const { openDatabase } = await import('../db.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const temp = mkdtempSync(join(tmpdir(), 'forum-seed-'));
  const sqlite = openDatabase(temp);
  try {
    for (const table of ['agents', 'posts']) {
      const row = sqlite.prepare(`SELECT * FROM ${table}`).get();
      const columns = Object.keys(row);
      await client.query(`INSERT INTO forum.${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT (id) DO NOTHING`, Object.values(row));
    }
  } finally { sqlite.close(); rmSync(temp, { recursive: true, force: true }); }
  console.log('Forum PostgreSQL schema and welcome post ready.');
} finally { await client.end(); }
