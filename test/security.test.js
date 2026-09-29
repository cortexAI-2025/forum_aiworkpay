import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openDatabase } from '../db.js';

const ADMIN = 'a-long-random-admin-token-for-tests-123';

async function harness(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forum-awp-sec-'));
  const db = openDatabase(dir);
  const server = createApp({ db, adminToken: ADMIN, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', data, key, rawBody) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(data !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: rawBody !== undefined ? rawBody : data !== undefined ? JSON.stringify(data) : undefined
    });
    let body = null;
    try { body = await response.json(); } catch {}
    return { status: response.status, body, headers: response.headers };
  };
  const close = async () => { await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { request, close };
}

const post = { kind: 'offer', category: 'other', title: 'A valid post title', body: 'A valid post body that is long enough.' };

test('non-object JSON bodies are rejected with 400, not 500', async () => {
  const { request, close } = await harness();
  try {
    for (const raw of ['null', '[]', '"text"', '42']) {
      assert.equal((await request('/api/v1/agents', 'POST', undefined, undefined, raw)).status, 400, raw);
    }
    assert.equal((await request('/api/v1/agents', 'POST', undefined, undefined, '{bad')).status, 400);
  } finally { await close(); }
});

test('agent names are unique, and the AIWorkPay name is reserved', async () => {
  const { request, close } = await harness();
  try {
    assert.equal((await request('/api/v1/agents', 'POST', { name: 'Scout', owner: 'Acme' })).status, 201);
    assert.equal((await request('/api/v1/agents', 'POST', { name: 'scout', owner: 'Other' })).status, 409);
    assert.equal((await request('/api/v1/agents', 'POST', { name: 'AIWorkPay', owner: 'Evil' })).status, 409);
    assert.equal((await request('/api/v1/agents', 'POST', { name: 'A.I. Work-Pay Official', owner: 'Evil' })).status, 409);
    assert.equal((await request('/api/v1/agents', 'POST', { name: 'AIWorkPay Bot', owner: 'AIWorkPay' }, ADMIN)).status, 201);
  } finally { await close(); }
});

test('over-length fields are rejected instead of silently truncated', async () => {
  const { request, close } = await harness();
  try {
    assert.equal((await request('/api/v1/agents', 'POST', { name: 'x'.repeat(81), owner: 'Acme' })).status, 400);
    const agent = (await request('/api/v1/agents', 'POST', { name: 'Writer', owner: 'Acme' })).body;
    assert.equal((await request('/api/v1/posts', 'POST', { ...post, title: 'x'.repeat(141) }, agent.api_key)).status, 400);
    assert.equal((await request('/api/v1/posts', 'POST', { ...post, body: 'y'.repeat(5001) }, agent.api_key)).status, 400);
    assert.equal((await request('/api/v1/posts', 'POST', { ...post, budget: 'z'.repeat(101) }, agent.api_key)).status, 400);
    assert.equal((await request('/api/v1/posts', 'POST', post, agent.api_key)).status, 201);
  } finally { await close(); }
});

test('suspending an agent hides its approved posts and replies', async () => {
  const { request, close } = await harness();
  try {
    const agent = (await request('/api/v1/agents', 'POST', { name: 'Spammer', owner: 'Acme' })).body;
    const created = (await request('/api/v1/posts', 'POST', post, agent.api_key)).body;
    await request(`/api/v1/admin/posts/${created.id}/moderation`, 'PATCH', { status: 'approved' }, ADMIN);
    assert.equal((await request('/api/v1/posts')).body.items.some(p => p.id === created.id), true);
    await request(`/api/v1/admin/agents/${agent.id}`, 'PATCH', { status: 'suspended' }, ADMIN);
    assert.equal((await request('/api/v1/posts')).body.items.some(p => p.id === created.id), false);
    assert.equal((await request(`/api/v1/posts/${created.id}`)).status, 404);
    assert.equal((await request('/api/v1/agents')).body.items.some(a => a.id === agent.id), false);
  } finally { await close(); }
});

test('search treats % and _ literally', async () => {
  const { request, close } = await harness();
  try {
    const agent = (await request('/api/v1/agents', 'POST', { name: 'Searcher', owner: 'Acme' })).body;
    const created = (await request('/api/v1/posts', 'POST', post, agent.api_key)).body;
    await request(`/api/v1/admin/posts/${created.id}/moderation`, 'PATCH', { status: 'approved' }, ADMIN);
    assert.equal((await request('/api/v1/posts?q=%25%25%25')).body.items.length, 0);
    assert.equal((await request('/api/v1/posts?q=valid')).body.items.length, 1);
    assert.equal((await request('/api/v1/posts?category=nope')).status, 400);
  } finally { await close(); }
});

test('an agent cannot exceed the pending moderation quota', async () => {
  const { request, close } = await harness();
  try {
    const agent = (await request('/api/v1/agents', 'POST', { name: 'Flooder', owner: 'Acme' })).body;
    let last;
    for (let i = 0; i < 11; i++) last = await request('/api/v1/posts', 'POST', { ...post, title: `Flood post number ${i}` }, agent.api_key);
    assert.equal(last.status, 429);
  } finally { await close(); }
});

test('moderation queue exposes budget and agent owner for review', async () => {
  const { request, close } = await harness();
  try {
    const agent = (await request('/api/v1/agents', 'POST', { name: 'Reviewed', owner: 'Acme Corp', description: 'Profile text' })).body;
    await request('/api/v1/posts', 'POST', { ...post, budget: '100 EUR' }, agent.api_key);
    const queue = (await request('/api/v1/admin/moderation', 'GET', undefined, ADMIN)).body;
    assert.equal(queue.posts[0].budget, '100 EUR');
    assert.equal(queue.posts[0].agent_owner, 'Acme Corp');
    assert.equal(queue.posts[0].agent_description, 'Profile text');
  } finally { await close(); }
});

test('weak or placeholder admin tokens disable admin endpoints', async () => {
  for (const adminToken of ['short', 'replace-with-a-long-random-secret']) {
    const { request, close } = await harness({ adminToken });
    try { assert.equal((await request('/api/v1/admin/agents', 'GET', undefined, adminToken)).status, 401); }
    finally { await close(); }
  }
});

test('security headers, and rate limiting keyed on the forwarded client when trusted', async () => {
  const { request, close } = await harness({ trustProxy: true });
  try {
    const response = await request('/health');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.ok(response.headers.get('strict-transport-security'));
  } finally { await close(); }

  const proxied = await harness({ trustProxy: true });
  const dir = mkdtempSync(join(tmpdir(), 'forum-awp-rl-'));
  const db = openDatabase(dir);
  const server = createApp({ db, adminToken: ADMIN, trustProxy: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const hit = ip => fetch(`${base}/health`, { headers: { 'X-Forwarded-For': `1.1.1.1, ${ip}` } }).then(r => r.status);
    for (let i = 0; i < 120; i++) assert.equal(await hit('9.9.9.9'), 200);
    assert.equal(await hit('9.9.9.9'), 429);
    assert.equal(await hit('8.8.8.8'), 200);
  } finally {
    await proxied.close();
    await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
