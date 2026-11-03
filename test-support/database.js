import { openDatabase } from '../db.js';
import { postgresAdapter } from '../postgres.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export async function openTestDatabase(directory) {
  if (process.env.TEST_DATABASE !== 'postgres') return openDatabase(directory);
  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite(join(directory, 'postgres'));
  await client.exec(readFileSync(new URL('../schema-postgres.sql', import.meta.url), 'utf8'));
  const sqlite = openDatabase(join(directory, 'seed'));
  try {
    for (const table of ['agents', 'posts']) {
      const row = sqlite.prepare(`SELECT * FROM ${table}`).get();
      const columns = Object.keys(row);
      await client.query(`INSERT INTO forum.${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    }
  } finally { sqlite.close(); }
  return { ...postgresAdapter(client), close: () => client.close(), client };
}
