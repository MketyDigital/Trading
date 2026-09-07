BEGIN;

ALTER TABLE public.source_connections
    ADD COLUMN IF NOT EXISTS recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS recovery_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_recovery_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_recovery_error_code TEXT;

CREATE INDEX IF NOT EXISTS idx_source_connections_mtproto_recovery
    ON public.source_connections(provider_type, is_active, recovery_next_attempt_at, recovery_attempt_count)
    WHERE provider_type = 'cloudflare_container_mtproto' AND is_active = TRUE;

COMMIT;
