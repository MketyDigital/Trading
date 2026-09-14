BEGIN;

ALTER TABLE public.position_groups
    ADD COLUMN IF NOT EXISTS state_key TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.position_legs
    ADD COLUMN IF NOT EXISTS leg_key TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_groups_workspace_state_key
    ON public.position_groups(workspace_id, state_key)
    WHERE state_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_legs_group_leg_key
    ON public.position_legs(position_group_id, leg_key)
    WHERE leg_key IS NOT NULL;

COMMIT;
