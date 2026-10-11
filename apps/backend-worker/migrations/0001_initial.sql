-- Initial schema (docs/spec.md "参照 > データ仕様 > Cloudflare D1").
-- IDs are UUIDs, timestamps are epoch milliseconds, revisions start at 1.
-- A purge deletes a product (or database) row and lets ON DELETE CASCADE remove what's under it.
-- Users are never deleted (withdrawal anonymizes them), so references to users don't cascade.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  agreed_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  products_revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target TEXT NOT NULL CHECK (target IN ('postgresql18', 'sqlite3')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER
);
CREATE INDEX products_deleted_at ON products (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE product_members (
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (product_id, user_id)
);
CREATE INDEX product_members_user_id ON product_members (user_id);
-- Exactly one owner per product: at most one here, at least one is kept by the API.
CREATE UNIQUE INDEX product_members_owner ON product_members (product_id) WHERE role = 'owner';

-- Emails are stored lowercased. Re-inviting an email deletes its previous row in the same batch.
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'member')),
  passcode_hash TEXT NOT NULL,
  passcode_encrypted TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users (id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (product_id, email)
);
CREATE INDEX invitations_passcode_hash ON invitations (passcode_hash);
CREATE INDEX invitations_expires_at ON invitations (expires_at);

CREATE TABLE passcode_failures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  failed_at INTEGER NOT NULL
);
CREATE INDEX passcode_failures_user_id_failed_at ON passcode_failures (user_id, failed_at);
CREATE INDEX passcode_failures_failed_at ON passcode_failures (failed_at);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  connection_string TEXT NOT NULL,
  password_encrypted TEXT,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX connections_product_id ON connections (product_id);

CREATE TABLE databases (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  common_columns TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at INTEGER
);
CREATE INDEX databases_product_id ON databases (product_id);
-- Names are unique within a product, except among deleted databases.
CREATE UNIQUE INDEX databases_product_id_name ON databases (product_id, name) WHERE deleted_at IS NULL;
CREATE INDEX databases_deleted_at ON databases (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('editing', 'provisional', 'final')),
  source_version_id TEXT REFERENCES versions (id) ON DELETE SET NULL,
  memo TEXT,
  provisional_at INTEGER,
  finalized_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  compacted_revision INTEGER NOT NULL DEFAULT 1,
  schema_count INTEGER NOT NULL DEFAULT 0,
  table_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (database_id, number)
);
CREATE INDEX versions_source_version_id ON versions (source_version_id);
-- At most one version that isn't final (editing or provisional) per database.
CREATE UNIQUE INDEX versions_unfinished ON versions (database_id) WHERE status <> 'final';

CREATE TABLE objects (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('schema', 'table', 'view', 'materialized_view', 'sequence')),
  schema_key TEXT,
  name TEXT NOT NULL,
  logical_name TEXT,
  definition TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users (id),
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (version_id, object_key)
);
CREATE INDEX objects_version_id_revision ON objects (version_id, revision);
-- Physical names are unique within a version and schema, except among deleted objects.
-- schema_key is NULL for schemas and on SQLite 3, and NULLs never collide in a UNIQUE index.
CREATE UNIQUE INDEX objects_version_id_schema_name ON objects (version_id, ifnull(schema_key, ''), name) WHERE deleted_at IS NULL;

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  target_type TEXT NOT NULL CHECK (target_type IN ('product', 'member', 'connection', 'database', 'version', 'object', 'deployment')),
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_logs_product_id_created_at ON audit_logs (product_id, created_at, id);
CREATE INDEX audit_logs_created_at ON audit_logs (created_at);

CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  connection_id TEXT REFERENCES connections (id) ON DELETE SET NULL,
  connection_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('build', 'migration')),
  from_version_id TEXT REFERENCES versions (id) ON DELETE CASCADE,
  to_version_id TEXT NOT NULL REFERENCES versions (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  log TEXT,
  executed_by TEXT NOT NULL REFERENCES users (id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX deployments_connection_id_started_at ON deployments (connection_id, started_at);
CREATE INDEX deployments_to_version_id_started_at ON deployments (to_version_id, started_at);
CREATE INDEX deployments_from_version_id ON deployments (from_version_id);
-- At most one running deployment per connection.
CREATE UNIQUE INDEX deployments_running ON deployments (connection_id) WHERE status = 'running';
