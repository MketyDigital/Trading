BEGIN;

-- Durable relational identity for the Trade State runtime. Runtime group/leg ids are
-- intentionally TEXT because the coordinator uses composite source/account identities;
-- the existing UUID primary keys remain the relational/audit identifiers.
ALTER TABLE public.position_groups
    ADD COLUMN IF NOT EXISTS runtime_group_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_groups_workspace_runtime_group
    ON public.position_groups(workspace_id, runtime_group_id)
    WHERE runtime_group_id IS NOT NULL;

ALTER TABLE public.position_legs
    ADD COLUMN IF NOT EXISTS runtime_leg_id TEXT,
    ADD COLUMN IF NOT EXISTS broker_deal_id TEXT,
    ADD COLUMN IF NOT EXISTS fill_price NUMERIC,
    ADD COLUMN IF NOT EXISTS executed_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS volume_step_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS minimum_lots NUMERIC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_legs_group_runtime_leg
    ON public.position_legs(position_group_id, runtime_leg_id)
    WHERE runtime_leg_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_position
    ON public.position_legs(workspace_id, broker_position_id)
    WHERE broker_position_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_order
    ON public.position_legs(workspace_id, broker_order_id)
    WHERE broker_order_id IS NOT NULL;

COMMIT;
