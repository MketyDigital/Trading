-- Operational health only; trading writes remain governed by the single-authority fence.
CREATE TABLE IF NOT EXISTS trading_storage.replication_health (
  consumer text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  source_sequence bigint NOT NULL DEFAULT 0 CHECK (source_sequence >= 0),
  applied_sequence bigint NOT NULL DEFAULT 0 CHECK (applied_sequence >= 0),
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, direction, authority_epoch)
);
CREATE TABLE IF NOT EXISTS trading_storage.replication_quarantine (
  consumer text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch bigint NOT NULL CHECK (authority_epoch > 0),
  sequence bigint NOT NULL CHECK (sequence > 0),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  error_code text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  attempts bigint NOT NULL DEFAULT 1 CHECK (attempts > 0),
  PRIMARY KEY (consumer, direction, authority_epoch, sequence)
);
