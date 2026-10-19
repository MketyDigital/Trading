CREATE INDEX IF NOT EXISTS idx_position_legs_broker_observation_due
    ON trading_storage.position_legs(status, last_broker_observed_at, created_at)
    WHERE status = 'OPEN' AND broker_position_id IS NOT NULL;
