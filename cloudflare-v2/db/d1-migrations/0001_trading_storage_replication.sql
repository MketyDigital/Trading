-- Foundational control-plane schema only. This is not the application data
-- schema and must not be used to cut over production until all domain tables
-- and repositories have been ported and parity-verified.
CREATE TABLE IF NOT EXISTS trading_storage_control (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  active_authority TEXT NOT NULL CHECK (active_authority IN ('d1', 'postgres')),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  writes_fenced INTEGER NOT NULL DEFAULT 1 CHECK (writes_fenced IN (0, 1)),
  updated_at TEXT NOT NULL
);

-- D1 is the planned initial authority, but remain fenced until the full
-- application schema and migration gate explicitly enable writes.
INSERT INTO trading_storage_control(singleton_id, active_authority, authority_epoch, schema_version, writes_fenced, updated_at)
VALUES (1, 'd1', 1, 1, 1, CURRENT_TIMESTAMP)
ON CONFLICT(singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trading_runtime_controls (
  control_key TEXT PRIMARY KEY CHECK (control_key IN ('trading_access_enabled', 'broker_execution_enabled', 'live_broker_execution_enabled')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO trading_runtime_controls (control_key, enabled, updated_by)
VALUES
  ('trading_access_enabled', 0, 'migration-default'),
  ('broker_execution_enabled', 0, 'migration-default'),
  ('live_broker_execution_enabled', 0, 'migration-default')
ON CONFLICT(control_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS trading_replication_counters (
  direction TEXT NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  PRIMARY KEY (direction, authority_epoch)
);

CREATE TABLE IF NOT EXISTS trading_replication_journal (
  direction TEXT NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  idempotency_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (direction, authority_epoch, sequence),
  UNIQUE (direction, authority_epoch, idempotency_key)
);

CREATE TABLE IF NOT EXISTS trading_replication_checkpoints (
  consumer TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
  last_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (consumer, direction, authority_epoch)
);

CREATE INDEX IF NOT EXISTS idx_trading_replication_journal_pending
  ON trading_replication_journal(direction, authority_epoch, sequence);
