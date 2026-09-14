BEGIN;

ALTER TABLE public.position_legs
    ADD COLUMN IF NOT EXISTS state_leg_id TEXT,
    ADD COLUMN IF NOT EXISTS requested_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS executed_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS remaining_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS broker_deal_id TEXT,
    ADD COLUMN IF NOT EXISTS volume_step_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS minimum_lots NUMERIC,
    ADD COLUMN IF NOT EXISTS failure_code TEXT,
    ADD COLUMN IF NOT EXISTS last_action_type TEXT;

-- Canonical hot state uses `lots` as the current remaining quantity. A fully
-- closed leg therefore reaches zero; retain the existing NOT NULL invariant
-- while permitting that terminal value in the durable mirror.
ALTER TABLE public.position_legs
    DROP CONSTRAINT IF EXISTS position_legs_lots_check;
ALTER TABLE public.position_legs
    ADD CONSTRAINT position_legs_lots_check CHECK (lots >= 0);

UPDATE public.position_legs
SET requested_lots = COALESCE(requested_lots, lots),
    remaining_lots = COALESCE(remaining_lots, lots)
WHERE requested_lots IS NULL OR remaining_lots IS NULL;

ALTER TABLE public.position_legs
    ALTER COLUMN requested_lots SET NOT NULL,
    ALTER COLUMN remaining_lots SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_legs_group_state_leg
    ON public.position_legs(position_group_id, state_leg_id)
    WHERE state_leg_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_position
    ON public.position_legs(workspace_id, broker_position_id)
    WHERE broker_position_id IS NOT NULL;

COMMIT;
