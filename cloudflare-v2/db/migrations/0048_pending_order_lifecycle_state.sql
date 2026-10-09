BEGIN;

ALTER TABLE public.position_legs
    ADD COLUMN IF NOT EXISTS parent_leg_id TEXT,
    ADD COLUMN IF NOT EXISTS lifecycle_role TEXT,
    ADD COLUMN IF NOT EXISTS lifecycle_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS originating_order_id TEXT,
    ADD COLUMN IF NOT EXISTS logical_target_index INTEGER,
    ADD COLUMN IF NOT EXISTS last_broker_observed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_broker_source_version TEXT,
    ADD COLUMN IF NOT EXISTS last_broker_status TEXT,
    ADD COLUMN IF NOT EXISTS last_broker_snapshot_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS broker_deal_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_position_legs_pending_order_lifecycle
    ON public.position_legs(workspace_id, broker_order_id)
    WHERE status = 'PENDING'
      AND lifecycle_tracking_enabled = TRUE
      AND broker_order_id IS NOT NULL;

COMMIT;
