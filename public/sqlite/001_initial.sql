-- Monetra Android local-first database, schema version 1.
PRAGMA foreign_keys = ON;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS local_schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS local_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  workspace_type TEXT NOT NULL CHECK (workspace_type IN ('personal', 'family', 'business')),
  name TEXT NOT NULL,
  snapshot_cursor TEXT NOT NULL DEFAULT '0' CHECK (length(snapshot_cursor) > 0),
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS local_workspaces_owner_idx ON local_workspaces(owner_id);

CREATE TABLE IF NOT EXISTS local_records (
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  parent_id TEXT,
  amount_minor INTEGER,
  occurred_at TEXT,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  server_cursor TEXT NOT NULL DEFAULT '0',
  local_updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, entity_type, entity_id),
  FOREIGN KEY (workspace_id) REFERENCES local_workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS local_records_type_idx ON local_records(workspace_id, entity_type, is_deleted);
CREATE INDEX IF NOT EXISTS local_records_parent_idx ON local_records(workspace_id, entity_type, parent_id, is_deleted);
CREATE INDEX IF NOT EXISTS local_records_activity_idx ON local_records(workspace_id, entity_type, occurred_at DESC, entity_id DESC);

CREATE TABLE IF NOT EXISTS sync_outbox (
  operation_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('transaction.create', 'transfer.create', 'debt.payment')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'conflict', 'rejected')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_attempt_at TEXT,
  last_error TEXT,
  server_result_json TEXT CHECK (server_result_json IS NULL OR json_valid(server_result_json)),
  FOREIGN KEY (workspace_id) REFERENCES local_workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sync_outbox_pending_idx ON sync_outbox(workspace_id, state, created_at, operation_id);

CREATE TABLE IF NOT EXISTS workspace_sync_state (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  pull_cursor TEXT NOT NULL DEFAULT '0',
  last_successful_pull_at TEXT,
  last_successful_push_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES local_workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_session_state (
  owner_id TEXT PRIMARY KEY NOT NULL,
  last_authenticated_at TEXT NOT NULL,
  lock_required INTEGER NOT NULL DEFAULT 1 CHECK (lock_required IN (0, 1))
);

INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (1);
