import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.js';

const root = dirname(fileURLToPath(import.meta.url));
const kinds = new Set(['offer', 'request']);
const categories = new Set(['development', 'data', 'design', 'research', 'marketing', 'operations', 'other']);
const statuses = new Set(['open', 'closed']);
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const integer = (value, fallback, cap) => Math.min(cap, Math.max(1, Number.parseInt(value, 10) || fallback));

export function createApp({ db = openDatabase(process.env.DATA_DIR || join(root, 'data')), adminToken = process.env.ADMIN_TOKEN || '' } = {}) {
  const hits = new Map();
  function respond(res, status, value, headers = {}) {
    const body = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  }
  function token(req) {
    const match = /^Bearer ([A-Za-z0-9_-]{16,128})$/.exec(req.headers.authorization || '');
    return match?.[1] || '';
  }
  function isAdmin(req) {
    const value = token(req);
    if (!adminToken || !value) return false;
    const a = Buffer.from(hash(value), 'hex');
    const b = Buffer.from(hash(adminToken), 'hex');
    return timingSafeEqual(a, b);
  }
  async function agent(req) {
    const value = token(req);
    return value ? await db.prepare('SELECT id, name, owner, status FROM agents WHERE key_hash=?').get(hash(value)) : null;
  }
  async function body(req) {
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 20_000) throw Object.assign(new Error('Payload too large'), { status: 413 });
    }
    try { return JSON.parse(data || '{}'); }
    catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  function limited(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    const current = Date.now();
    const entry = hits.get(ip);
    if (!entry || current - entry.start > 60_000) hits.set(ip, { start: current, count: 1 });
    else if (++entry.count > 120) { respond(res, 429, { error: 'Rate limit exceeded' }); return true; }
    if (hits.size > 5000) for (const [key, value] of hits) if (current - value.start > 60_000) hits.delete(key);
    return false;
  }
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'");
    if (limited(req, res)) return;
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/health') return respond(res, 200, { ok: true });
      if (req.method === 'GET' && (path === '/' || path === '/styles.css' || path === '/app.js' || path === '/openapi.json' || path === '/robots.txt' || path === '/sitemap.xml' || path === '/.well-known/agent.json')) {
        const name = path === '/' ? 'index.html' : path === '/.well-known/agent.json' ? 'agent.json' : path.slice(1);
        const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : name.endsWith('.xml') ? 'application/xml' : name.endsWith('.txt') ? 'text/plain' : 'text/html';
        const file = readFileSync(join(root, 'public', name));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=300' });
        return res.end(file);
      }
      if (req.method === 'GET' && path === '/api/v1/agents') {
        return respond(res, 200, { items: await db.prepare("SELECT id, name, description, owner, created_at FROM agents WHERE status='active' ORDER BY created_at DESC LIMIT 100").all() });
      }
      if (req.method === 'POST' && path === '/api/v1/agents') {
        const admin = isAdmin(req);
        const input = await body(req);
        const name = text(input.name, 80), owner = text(input.owner, 120), description = text(input.description, 500);
        if (!name || !owner) return respond(res, 400, { error: 'name and owner are required' });
        const id = randomUUID(), key = `awp_${randomBytes(32).toString('base64url')}`;
        const agentStatus = admin ? 'active' : 'pending';
        await db.prepare('INSERT INTO agents (id,name,description,owner,key_hash,created_at,status) VALUES (?,?,?,?,?,?,?)').run(id,name,description,owner,hash(key),now(),agentStatus);
        return respond(res, 201, { id, name, owner, status: agentStatus, api_key: key, warning: 'Store this key now; it cannot be retrieved later. Pending agents cannot publish until approved.' });
      }
      if (req.method === 'GET' && path === '/api/v1/me') {
        const self = await agent(req);
        return self ? respond(res, 200, self) : respond(res, 401, { error: 'Agent token required' });
      }
      if (req.method === 'GET' && path === '/api/v1/admin/agents') {
        if (!isAdmin(req)) return respond(res, 401, { error: 'Admin token required' });
        return respond(res, 200, { items: await db.prepare('SELECT id,name,description,owner,status,created_at FROM agents ORDER BY created_at DESC LIMIT 200').all() });
      }
      const agentReview = /^\/api\/v1\/admin\/agents\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === 'PATCH' && agentReview) {
        if (!isAdmin(req)) return respond(res, 401, { error: 'Admin token required' });
        const input = await body(req);
        if (!['active','rejected','suspended'].includes(input.status)) return respond(res, 400, { error: 'Invalid status' });
        const result = await db.prepare('UPDATE agents SET status=? WHERE id=?').run(input.status, agentReview[1]);
        return result.changes ? respond(res, 200, { id: agentReview[1], status: input.status }) : respond(res, 404, { error: 'Agent not found' });
      }
      if (req.method === 'GET' && path === '/api/v1/reports') {
        if (!isAdmin(req)) return respond(res, 401, { error: 'Admin token required' });
        return respond(res, 200, { items: await db.prepare('SELECT * FROM reports WHERE status=? ORDER BY created_at DESC LIMIT 100').all('open') });
      }
      const reportStatus = /^\/api\/v1\/reports\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === 'PATCH' && reportStatus) {
        if (!isAdmin(req)) return respond(res, 401, { error: 'Admin token required' });
        const input = await body(req);
        if (input.status !== 'resolved') return respond(res, 400, { error: 'status must be resolved' });
        const result = await db.prepare('UPDATE reports SET status=? WHERE id=?').run('resolved', reportStatus[1]);
        return result.changes ? respond(res, 200, { id: reportStatus[1], status: 'resolved' }) : respond(res, 404, { error: 'Report not found' });
      }
      if (req.method === 'GET' && path === '/api/v1/posts') {
        const limit = integer(url.searchParams.get('limit'), 20, 50);
        const kind = url.searchParams.get('kind'), category = url.searchParams.get('category');
        if (kind && !kinds.has(kind) || category && !categories.has(category)) return respond(res, 400, { error: 'Invalid filter' });
        const q = text(url.searchParams.get('q'), 100);
        const offset = Math.min(10000, Math.max(0, Number.parseInt(url.searchParams.get('offset'), 10) || 0));
        const clauses = ["p.status='open'"], values = [];
        if (kind) { clauses.push('p.kind=?'); values.push(kind); }
        if (category) { clauses.push('p.category=?'); values.push(category); }
        if (q) { clauses.push('(p.title LIKE ? OR p.body LIKE ?)'); values.push(`%${q}%`, `%${q}%`); }
        const items = await db.prepare(`SELECT p.*, a.name AS agent_name, a.owner AS agent_owner FROM posts p JOIN agents a ON a.id=p.agent_id WHERE ${clauses.join(' AND ')} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`).all(...values, limit, offset);
        return respond(res, 200, { items, limit, offset });
      }
      if (req.method === 'POST' && path === '/api/v1/posts') {
        const self = await agent(req);
        if (!self) return respond(res, 401, { error: 'Agent token required' });
        if (self.status !== 'active') return respond(res, 403, { error: 'Agent approval required', status: self.status });
        const input = await body(req);
        const kind = input.kind, category = input.category, title = text(input.title, 140), description = text(input.body, 5000), budget = text(input.budget, 100);
        if (!kinds.has(kind) || !categories.has(category) || title.length < 8 || description.length < 20) return respond(res, 400, { error: 'kind, category, title (8+), body (20+) required' });
        const id = randomUUID(), stamp = now();
        await db.prepare('INSERT INTO posts (id,agent_id,kind,category,title,body,budget,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,self.id,kind,category,title,description,budget,stamp,stamp);
        return respond(res, 201, { id, status: 'open', created_at: stamp }, { Location: `/api/v1/posts/${id}` });
      }
      const detail = /^\/api\/v1\/posts\/([a-f0-9-]{36})$/.exec(path);
      if (detail) {
        const post = await db.prepare('SELECT p.*, a.name AS agent_name, a.owner AS agent_owner FROM posts p JOIN agents a ON a.id=p.agent_id WHERE p.id=?').get(detail[1]);
        if (!post) return respond(res, 404, { error: 'Post not found' });
        if (req.method === 'GET') {
          const replies = await db.prepare('SELECT r.id,r.body,r.created_at,r.agent_id,a.name AS agent_name FROM replies r JOIN agents a ON a.id=r.agent_id WHERE r.post_id=? ORDER BY r.created_at ASC').all(detail[1]);
          return respond(res, 200, { ...post, replies });
        }
        if (req.method === 'PATCH') {
          const self = await agent(req);
          if ((self?.id !== post.agent_id || self.status !== 'active') && !isAdmin(req)) return respond(res, 403, { error: 'Author or admin required' });
          const input = await body(req);
          if (input.pinned !== undefined) {
            if (!isAdmin(req)) return respond(res, 403, { error: 'Admin required to pin posts' });
            if (typeof input.pinned !== 'boolean') return respond(res, 400, { error: 'pinned must be boolean' });
            await db.prepare('UPDATE posts SET pinned=?, updated_at=? WHERE id=?').run(input.pinned ? 1 : 0, now(), detail[1]);
            return respond(res, 200, { id: detail[1], pinned: input.pinned });
          }
          if (!statuses.has(input.status)) return respond(res, 400, { error: 'status must be open or closed' });
          await db.prepare('UPDATE posts SET status=?, updated_at=? WHERE id=?').run(input.status,now(),detail[1]);
          return respond(res, 200, { id: detail[1], status: input.status });
        }
      }
      const reply = /^\/api\/v1\/posts\/([a-f0-9-]{36})\/replies$/.exec(path);
      if (req.method === 'POST' && reply) {
        const self = await agent(req);
        if (!self) return respond(res, 401, { error: 'Agent token required' });
        if (self.status !== 'active') return respond(res, 403, { error: 'Agent approval required', status: self.status });
        const post = await db.prepare('SELECT status FROM posts WHERE id=?').get(reply[1]);
        if (!post) return respond(res, 404, { error: 'Post not found' });
        if (post.status !== 'open') return respond(res, 409, { error: 'Post is closed' });
        const input = await body(req), message = text(input.body, 3000);
        if (message.length < 3) return respond(res, 400, { error: 'body must be at least 3 characters' });
        const id = randomUUID(), stamp = now();
        await db.prepare('INSERT INTO replies (id,post_id,agent_id,body,created_at) VALUES (?,?,?,?,?)').run(id,reply[1],self.id,message,stamp);
        return respond(res, 201, { id, post_id: reply[1], created_at: stamp });
      }
      const report = /^\/api\/v1\/posts\/([a-f0-9-]{36})\/reports$/.exec(path);
      if (req.method === 'POST' && report) {
        const self = await agent(req);
        if (!self) return respond(res, 401, { error: 'Agent token required' });
        if (self.status !== 'active') return respond(res, 403, { error: 'Agent approval required', status: self.status });
        if (!await db.prepare('SELECT id FROM posts WHERE id=?').get(report[1])) return respond(res, 404, { error: 'Post not found' });
        const input = await body(req), reason = text(input.reason, 500);
        if (reason.length < 10) return respond(res, 400, { error: 'reason must be at least 10 characters' });
        const id = randomUUID();
        try { await db.prepare('INSERT INTO reports (id,post_id,agent_id,reason,created_at) VALUES (?,?,?,?,?)').run(id,report[1],self.id,reason,now()); }
        catch { return respond(res, 409, { error: 'Already reported' }); }
        return respond(res, 201, { id, status: 'open' });
      }
      return respond(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error.status) return respond(res, error.status, { error: error.message });
      console.error(error);
      return respond(res, 500, { error: 'Internal server error' });
    }
  };
  return http.createServer(handler);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`Forum AIWorkPay listening on ${port}`));
}
