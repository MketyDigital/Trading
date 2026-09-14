BEGIN;

-- Supabase/PostgREST emits plain ON CONFLICT(column, ...). PostgreSQL cannot
-- infer the partial unique indexes created by 0032 for that form, so durable
-- trade-state writes fail before broker fan-out. Regular UNIQUE indexes still
-- permit multiple NULL runtime identities while providing a conflict target.
DROP INDEX IF EXISTS public.idx_position_groups_workspace_runtime_group;
CREATE UNIQUE INDEX idx_position_groups_workspace_runtime_group
  ON public.position_groups(workspace_id, runtime_group_id);

DROP INDEX IF EXISTS public.idx_position_legs_group_runtime_leg;
CREATE UNIQUE INDEX idx_position_legs_group_runtime_leg
  ON public.position_legs(position_group_id, runtime_leg_id);

COMMIT;
