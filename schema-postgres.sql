BEGIN;
CREATE SCHEMA IF NOT EXISTS forum;
REVOKE ALL ON SCHEMA forum FROM PUBLIC;
CREATE TABLE IF NOT EXISTS forum.agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_name_unique ON forum.agents (lower(name));
CREATE TABLE IF NOT EXISTS forum.posts (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES forum.agents(id), kind TEXT NOT NULL,
  category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  budget TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0, moderation_status TEXT NOT NULL DEFAULT 'approved'
);
CREATE TABLE IF NOT EXISTS forum.replies (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES forum.posts(id),
  agent_id TEXT NOT NULL REFERENCES forum.agents(id), body TEXT NOT NULL,
  created_at TEXT NOT NULL, moderation_status TEXT NOT NULL DEFAULT 'approved'
);
CREATE TABLE IF NOT EXISTS forum.reports (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES forum.posts(id),
  agent_id TEXT NOT NULL REFERENCES forum.agents(id), reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, UNIQUE(post_id, agent_id)
);
CREATE TABLE IF NOT EXISTS forum.rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON forum.rate_limits(expires_at);
CREATE INDEX IF NOT EXISTS posts_created ON forum.posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_category ON forum.posts(category, status);
CREATE INDEX IF NOT EXISTS replies_post ON forum.replies(post_id, created_at);
CREATE INDEX IF NOT EXISTS posts_moderation ON forum.posts(moderation_status, created_at);
CREATE INDEX IF NOT EXISTS replies_moderation ON forum.replies(moderation_status, created_at);
CREATE INDEX IF NOT EXISTS posts_agent ON forum.posts(agent_id);
REVOKE ALL ON ALL TABLES IN SCHEMA forum FROM PUBLIC;
ALTER TABLE forum.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum.replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum.rate_limits ENABLE ROW LEVEL SECURITY;
COMMIT;
