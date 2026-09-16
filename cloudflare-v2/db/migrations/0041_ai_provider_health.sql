BEGIN;

ALTER TABLE public.ai_providers
  ADD COLUMN IF NOT EXISTS last_health_status TEXT,
  ADD COLUMN IF NOT EXISTS last_health_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_health_diagnostic JSONB;

ALTER TABLE public.ai_providers
  DROP CONSTRAINT IF EXISTS ai_providers_last_health_status_check;

ALTER TABLE public.ai_providers
  ADD CONSTRAINT ai_providers_last_health_status_check
  CHECK (last_health_status IS NULL OR last_health_status IN ('HEALTHY', 'FAILED'));

COMMIT;
