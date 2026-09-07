BEGIN;

ALTER TABLE public.position_groups
    ADD COLUMN IF NOT EXISTS source_instance_id TEXT,
    ADD COLUMN IF NOT EXISTS source_event_ids TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS thread_id TEXT,
    ADD COLUMN IF NOT EXISTS incomplete BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS position_mode TEXT NOT NULL DEFAULT 'HEDGED'
        CHECK (position_mode IN ('HEDGED', 'NETTED', 'SPREAD_BETTING'));

CREATE INDEX IF NOT EXISTS idx_position_groups_source_state
    ON public.position_groups(workspace_id, source_instance_id, status, updated_at DESC)
    WHERE status IN ('OPEN', 'PLANNED', 'PENDING');

ALTER TABLE public.trade_accounts
    ADD COLUMN IF NOT EXISTS execution_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS safety_policy JSONB NOT NULL DEFAULT '{"enabled":true,"killSwitch":false}'::jsonb,
    ADD COLUMN IF NOT EXISTS fast_entry_policy TEXT NOT NULL DEFAULT 'wait_for_complete_signal'
        CHECK (fast_entry_policy IN ('execute_immediately', 'wait_for_complete_signal', 'forward_only')),
    ADD COLUMN IF NOT EXISTS entry_zone_policy TEXT NOT NULL DEFAULT 'nearest_boundary'
        CHECK (entry_zone_policy IN ('nearest_boundary', 'market_if_inside', 'midpoint', 'lower', 'upper', 'market_only'));

CREATE INDEX IF NOT EXISTS idx_trade_accounts_workspace
    ON public.trade_accounts(workspace_id);

COMMIT;
