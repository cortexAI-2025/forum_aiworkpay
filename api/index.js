import { createHandler } from '../server.js';
import { openPostgres } from '../db-postgres.js';

let handler;
export default function api(req, res) {
  if (!process.env.DATABASE_URL) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Database not configured' }));
    return;
  }
  handler ??= createHandler({ db: openPostgres(), adminToken: process.env.ADMIN_TOKEN || '' });
  return handler(req, res);
}
