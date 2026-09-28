import pg from 'pg';

const schema = `
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
`;

export function openPostgres(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  let initialized;
  async function query(sql, args) {
    initialized ??= pool.query(schema).catch(error => { initialized = undefined; throw error; });
    await initialized;
    let index = 0;
    const statement = sql.replace(/\?/g, () => `$${++index}`);
    const result = await pool.query(statement, args);
    return result;
  }
  return {
    prepare(sql) {
      return {
        async get(...args) { return (await query(sql, args)).rows[0]; },
        async all(...args) { return (await query(sql, args)).rows; },
        async run(...args) { return { changes: (await query(sql, args)).rowCount }; }
      };
    },
    close() { return pool.end(); }
  };
}
