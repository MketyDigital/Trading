-- Operational health only; trading writes remain governed by the single-authority fence.
CREATE TABLE IF NOT EXISTS trading_replication_health (
  consumer TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
  source_sequence INTEGER NOT NULL DEFAULT 0 CHECK (source_sequence >= 0),
  applied_sequence INTEGER NOT NULL DEFAULT 0 CHECK (applied_sequence >= 0),
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (consumer, direction, authority_epoch)
);
CREATE TABLE IF NOT EXISTS trading_replication_quarantine (
  consumer TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('d1_to_postgres', 'postgres_to_d1')),
  authority_epoch INTEGER NOT NULL CHECK (authority_epoch > 0),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  error_code TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  PRIMARY KEY (consumer, direction, authority_epoch, sequence)
);
