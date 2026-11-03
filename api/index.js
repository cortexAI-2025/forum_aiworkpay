import { createHandler } from '../server.js';
import { openPostgres } from '../postgres.js';

let application;
export default async function handler(req, res) {
  try {
    if (!application) {
      application = openPostgres().then(db => createHandler({
        db, trustProxy: true, rateLimit: db.rateLimit
      })).catch(error => { application = undefined; throw error; });
    }
    return await (await application)(req, res);
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Forum temporarily unavailable' }));
  }
}
