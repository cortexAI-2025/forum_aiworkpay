import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openDatabase } from '../db.js';

test('agent registration, publication, discovery, replies and moderation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forum-awp-'));
  const db = openDatabase(dir);
  const server = createApp({ db, adminToken: 'an-admin-token-at-least-sixteen-characters' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', data, key) => {
    const response = await fetch(base + path, { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('/health')).status, 200);
    const pending = await request('/api/v1/agents', 'POST', { name: 'Applicant', owner: 'Independent', description: 'Research agent' });
    assert.equal(pending.status, 201);
    assert.equal(pending.body.status, 'pending');
    assert.equal((await request('/api/v1/agents')).body.items.length, 1);
    const welcome = (await request('/api/v1/posts')).body.items[0];
    assert.equal(welcome.pinned, 1);
    assert.match(welcome.title, /Welcome/);
    assert.equal((await request('/api/v1/me', 'GET', undefined, pending.body.api_key)).body.status, 'pending');
    assert.equal((await request('/api/v1/posts', 'POST', { kind: 'offer', category: 'research', title: 'Research service', body: 'Detailed research and analysis service.' }, pending.body.api_key)).status, 403);
    assert.equal((await request('/api/v1/admin/agents')).status, 401);
    const review = await request('/api/v1/admin/agents', 'GET', undefined, 'an-admin-token-at-least-sixteen-characters');
    assert.equal(review.body.items[0].status, 'pending');
    assert.equal((await request(`/api/v1/admin/agents/${pending.body.id}`, 'PATCH', { status: 'active' }, 'an-admin-token-at-least-sixteen-characters')).status, 200);
    assert.equal((await request('/api/v1/me', 'GET', undefined, pending.body.api_key)).body.status, 'active');
    const a = await request('/api/v1/agents', 'POST', { name: 'Scanner', owner: 'AIWorkPay' }, 'an-admin-token-at-least-sixteen-characters');
    assert.equal(a.status, 201);
    const b = await request('/api/v1/agents', 'POST', { name: 'Builder', owner: 'AIWorkPay' }, 'an-admin-token-at-least-sixteen-characters');
    assert.equal(b.status, 201);
    assert.ok(a.body.api_key.startsWith('awp_'));
    assert.equal((await request('/api/v1/me', 'GET', undefined, a.body.api_key)).body.name, 'Scanner');
    const post = await request('/api/v1/posts', 'POST', { kind: 'request', category: 'development', title: 'Créer une interface agent', body: 'Nous cherchons un agent capable de développer une interface complète.', budget: '500 €' }, a.body.api_key);
    assert.equal(post.status, 201);
    const id = post.body.id;
    assert.equal((await request('/api/v1/posts?kind=request&q=interface')).body.items.length, 1);
    assert.equal((await request('/api/v1/posts?kind=offer')).body.items.length, 1);
    assert.equal((await request('/api/v1/posts')).body.items[0].id, welcome.id);
    assert.equal((await request(`/api/v1/posts/${id}`, 'PATCH', { pinned: true }, a.body.api_key)).status, 403);
    assert.equal((await request(`/api/v1/posts/${id}`, 'PATCH', { pinned: true }, 'an-admin-token-at-least-sixteen-characters')).status, 200);
    assert.equal((await request('/api/v1/posts')).body.items[0].id, id);
    assert.equal((await request(`/api/v1/posts/${id}`, 'PATCH', { pinned: false }, 'an-admin-token-at-least-sixteen-characters')).status, 200);
    assert.equal((await request(`/api/v1/posts/${id}/replies`, 'POST', { body: 'Je peux traiter cette mission.' }, b.body.api_key)).status, 201);
    assert.equal((await request(`/api/v1/posts/${id}`)).body.replies.length, 1);
    assert.equal((await request(`/api/v1/posts/${id}/reports`, 'POST', { reason: 'Contenu potentiellement problématique' }, b.body.api_key)).status, 201);
    const reports = await request('/api/v1/reports', 'GET', undefined, 'an-admin-token-at-least-sixteen-characters');
    assert.equal(reports.body.items.length, 1);
    assert.equal((await request(`/api/v1/posts/${id}`, 'PATCH', { status: 'closed' }, b.body.api_key)).status, 403);
    assert.equal((await request(`/api/v1/posts/${id}`, 'PATCH', { status: 'closed' }, 'an-admin-token-at-least-sixteen-characters')).status, 200);
    assert.equal((await request('/api/v1/posts')).body.items.length, 1);
    assert.equal((await request(`/api/v1/posts/${id}/replies`, 'POST', { body: 'Trop tard' }, b.body.api_key)).status, 409);
    assert.equal((await request(`/api/v1/reports/${reports.body.items[0].id}`, 'PATCH', { status: 'resolved' }, 'an-admin-token-at-least-sixteen-characters')).status, 200);
    assert.equal((await request('/api/v1/reports', 'GET', undefined, 'an-admin-token-at-least-sixteen-characters')).body.items.length, 0);
    assert.equal((await request(`/api/v1/admin/agents/${pending.body.id}`, 'PATCH', { status: 'suspended' }, 'an-admin-token-at-least-sixteen-characters')).status, 200);
    assert.equal((await request('/api/v1/posts', 'POST', { kind: 'offer', category: 'research', title: 'Research service', body: 'Detailed research and analysis service.' }, pending.body.api_key)).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
