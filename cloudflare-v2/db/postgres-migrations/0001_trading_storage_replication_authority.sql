-- Dedicated schema for the future Trading Worker storage authority.
-- This may share Mkety's existing central PostgreSQL database, but it must
-- only create or mutate objects inside trading_storage; never alter public.
CREATE SCHEMA IF NOT EXISTS trading_storage;

CREATE TABLE IF NOT EXISTS trading_storage.authority_control (
  singleton_id smallint PRIMARY KEY CHECK (singleton_id = 1),
  active_authority text NOT NULL CHECK (active_authority IN ('d1', 'postgres')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  writes_fenced boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep both freshly migrated stores fenced. D1 is only the planned initial
-- authority; an explicit cutover procedure must activate writes after parity.
INSERT INTO trading_storage.authority_control(singleton_id, active_authority, authority_epoch, schema_version, writes_fenced)
VALUES (1, 'd1', 1, 1, true)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS trading_storage.runtime_controls (
  control_key text PRIMARY KEY CHECK (control_key IN ('trading_access_enabled', 'broker_execution_enabled', 'live_broker_execution_enabled')),
  enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO trading_storage.runtime_controls (control_key, enabled, updated_by)
VALUES
  ('trading_access_enabled', false, 'migration-default'),
  ('broker_execution_enabled', false, 'migration-default'),
  ('live_broker_execution_enabled', false, 'migration-default')
ON CONFLICT (control_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS trading_storage.replication_counters (
  direction text NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  PRIMARY KEY (direction, authority_epoch)
);

CREATE TABLE IF NOT EXISTS trading_storage.replication_journal (
  direction text NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  sequence bigint NOT NULL CHECK (sequence > 0),
  idempotency_key text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (direction, authority_epoch, sequence),
  UNIQUE (direction, authority_epoch, idempotency_key)
);

CREATE TABLE IF NOT EXISTS trading_storage.replication_checkpoints (
  consumer text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, direction, authority_epoch)
);

CREATE INDEX IF NOT EXISTS idx_replication_journal_pending
  ON trading_storage.replication_journal(direction, authority_epoch, sequence);
