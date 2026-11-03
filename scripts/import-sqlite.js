import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const filename = process.argv[2];
if (!filename || !process.env.DATABASE_URL) throw new Error('Usage: DATABASE_URL=... npm run db:import -- /path/to/forum.sqlite');
const { Client } = await import('pg');
const source = new DatabaseSync(filename, { readOnly: true });
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(readFileSync(new URL('../schema-postgres.sql', import.meta.url), 'utf8'));
  await client.query('BEGIN');
  // Import only into a new database. Never silently discard conflicting identities or messages.
  const { rows } = await client.query('SELECT COUNT(*) AS n FROM forum.agents');
  if (Number(rows[0].n)) throw new Error('Destination must be empty. Import before running db:setup.');
  const counts = {};
  for (const table of ['agents', 'posts', 'replies', 'reports']) {
    const records = source.prepare(`SELECT * FROM ${table}`).all();
    for (const row of records) {
      const columns = Object.keys(row);
      const allowed = new Set(['id','name','description','owner','key_hash','created_at','status','agent_id','kind','category','title','body','budget','updated_at','pinned','moderation_status','post_id','reason']);
      if (!columns.every(column => allowed.has(column))) throw new Error('Unsupported source columns');
      await client.query(`INSERT INTO forum.${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    }
    counts[table] = records.length;
  }
  await client.query('COMMIT');
  console.log('Import complete. Counts:', JSON.stringify(counts));
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Import rolled back. Source was not modified.');
  // Do not log database errors: they may contain private row data or hashes.
  process.exitCode = 1;
} finally { source.close(); await client.end(); }
