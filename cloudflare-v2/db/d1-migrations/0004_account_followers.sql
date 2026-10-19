CREATE TABLE IF NOT EXISTS trading_account_followers (
  id TEXT NOT NULL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  follower_account_id TEXT NOT NULL,
  parent_account_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  lot_multiplier TEXT NOT NULL DEFAULT '1',
  fixed_lot TEXT,
  last_source_version TEXT,
  last_state_fingerprint TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES trading_workspace_access(id) ON DELETE CASCADE,
  FOREIGN KEY (follower_account_id) REFERENCES trade_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_account_id) REFERENCES trade_accounts(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, follower_account_id)
);

CREATE INDEX IF NOT EXISTS idx_trading_account_followers_parent_due
  ON trading_account_followers(workspace_id, parent_account_id, enabled, updated_at);
CREATE INDEX IF NOT EXISTS idx_trading_account_followers_follower
  ON trading_account_followers(workspace_id, follower_account_id, enabled);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_binding_repair
  ON destination_deliveries(status, failure_class, updated_at)
  WHERE status = 'SUCCEEDED' AND failure_class = 'STATE_BINDING_PENDING';
