import { createHash } from 'node:crypto';

const tables = new Set(['agents', 'posts', 'replies', 'reports']);

// Translate only SQL tokens, leaving quoted literals and identifiers unchanged.
export function postgresSql(sql) {
  let parameter = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|\b[a-zA-Z_][a-zA-Z_0-9]*\b/g, token => {
    if (token === '?') return `$${++parameter}`;
    if (tables.has(token)) return `forum.${token}`;
    if (token.toUpperCase() === 'LIKE') return 'ILIKE';
    return token;
  });
}

export function postgresAdapter(client) {
  return {
    prepare(sql) {
      const query = postgresSql(sql);
      return {
        async all(...values) { return (await client.query(query, values)).rows; },
        async get(...values) { return (await client.query(query, values)).rows[0]; },
        async run(...values) {
          const result = await client.query(query, values);
          return { changes: result.rowCount ?? result.affectedRows ?? 0 };
        }
      };
    },
    async rateLimit(scope, ip, limit, seconds) {
      const key = createHash('sha256').update(`${scope}:${ip}`).digest('hex');
      const { rows } = await client.query(`
        INSERT INTO forum.rate_limits (key, hits, expires_at)
        VALUES ($1, 1, clock_timestamp() + $2 * interval '1 second')
        ON CONFLICT (key) DO UPDATE SET
          hits = CASE WHEN forum.rate_limits.expires_at <= clock_timestamp() THEN 1 ELSE forum.rate_limits.hits + 1 END,
          expires_at = CASE WHEN forum.rate_limits.expires_at <= clock_timestamp() THEN EXCLUDED.expires_at ELSE forum.rate_limits.expires_at END
        RETURNING hits`, [key, seconds]);
      // Remove expired buckets without storing IP addresses. Each request cleans at most 100.
      await client.query(`DELETE FROM forum.rate_limits WHERE key IN
        (SELECT key FROM forum.rate_limits WHERE expires_at < clock_timestamp() LIMIT 100)`);
      return Number(rows[0].hits) <= limit;
    }
  };
}

export async function openPostgres(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 20000, allowExitOnIdle: true });
  pool.on('error', () => console.error('PostgreSQL idle connection failed'));
  return { ...postgresAdapter(pool), close: () => pool.end() };
}
