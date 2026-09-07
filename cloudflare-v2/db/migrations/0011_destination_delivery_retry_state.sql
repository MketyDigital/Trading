-- Durable destination retry/recovery metadata for Trading-owned delivery idempotency.
-- Additive only: existing workspace-scoped idempotency authority remains unchanged.

ALTER TABLE public.destination_deliveries
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_class TEXT;

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_retry_due
  ON public.destination_deliveries(status, next_attempt_at, workspace_id)
  WHERE status = 'RETRYABLE';
