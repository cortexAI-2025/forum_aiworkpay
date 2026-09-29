import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'forum.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), kind TEXT NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      budget TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS replies (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
      agent_id TEXT NOT NULL REFERENCES agents(id), body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id),
      agent_id TEXT NOT NULL REFERENCES agents(id), reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL,
      UNIQUE(post_id, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category, status);
    CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id, created_at);
  `);
  const columns = db.prepare("PRAGMA table_info(agents)").all().map(column => column.name);
  if (!columns.includes('status')) db.exec("ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  return db;
}
