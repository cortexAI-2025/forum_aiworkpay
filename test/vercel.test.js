import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestDatabase } from '../test-support/database.js';
import { postgresSql } from '../postgres.js';
import { createApp } from '../server.js';
import handler from '../api/index.js';

test('PostgreSQL translation preserves literal question marks and uses bound values', () => {
  assert.equal(postgresSql("SELECT * FROM posts WHERE title='agents?' AND body LIKE ? ESCAPE '\\'"),
    "SELECT * FROM forum.posts WHERE title='agents?' AND body ILIKE $1 ESCAPE '\\'");
});

test('Vercel returns 503 without a durable database and creates no temporary SQLite database', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
    await handler({}, response);
    assert.equal(response.status, 503);
    assert.equal(response.body.error, 'Forum temporarily unavailable');
  } finally { if (previous !== undefined) process.env.DATABASE_URL = previous; }
});

test('PostgreSQL rate limits survive application recreation and share atomic counters', { skip: process.env.TEST_DATABASE !== 'postgres' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forum-limits-'));
  const db = await openTestDatabase(directory);
  let first, second;
  try {
    first = createApp({ db, rateLimit: db.rateLimit });
    second = createApp({ db, rateLimit: db.rateLimit });
    await Promise.all([first, second].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
    const url = server => `http://127.0.0.1:${server.address().port}/health`;
    const statuses = await Promise.all(Array.from({ length: 121 }, (_, i) => fetch(url(i % 2 ? first : second)).then(r => r.status)));
    assert.equal(statuses.filter(status => status === 200).length, 120);
    assert.equal(statuses.filter(status => status === 429).length, 1);
    const keys = (await db.client.query('SELECT key FROM forum.rate_limits')).rows;
    assert.equal(keys.length, 1);
    assert.match(keys[0].key, /^[a-f0-9]{64}$/);
    await db.client.query("UPDATE forum.rate_limits SET expires_at=clock_timestamp()-interval '1 second'");
    assert.equal((await fetch(url(first))).status, 200);
  } finally {
    await Promise.all([first, second].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
    await db.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('PostgreSQL enforces case-insensitive agent uniqueness under concurrent registration', { skip: process.env.TEST_DATABASE !== 'postgres' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'forum-race-'));
  const db = await openTestDatabase(directory);
  const server = createApp({ db });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/v1/agents`;
    const statuses = await Promise.all(['Concurrent', 'CONCURRENT'].map(name => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, owner: 'Test' })
    }).then(response => response.status)));
    assert.deepEqual(statuses.sort(), [201, 409]);
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); rmSync(directory, { recursive: true, force: true }); }
});
