BEGIN;

-- The protection reader is intentionally due-only. This keeps current-position
-- snapshots bounded instead of re-reading every open leg on every cron tick.
CREATE INDEX IF NOT EXISTS idx_position_legs_broker_observation_due
    ON public.position_legs(status, last_broker_observed_at, created_at)
    WHERE status = 'OPEN' AND broker_position_id IS NOT NULL;

COMMIT;
