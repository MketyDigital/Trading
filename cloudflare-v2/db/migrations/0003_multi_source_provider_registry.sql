BEGIN;

-- Extend the existing Trading-owned source registry without removing or
-- renaming legacy-compatible columns used by signed V1 ingress.
ALTER TABLE public.source_connections
    ADD COLUMN IF NOT EXISTS source_family TEXT,
    ADD COLUMN IF NOT EXISTS provider_type TEXT,
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS external_identity TEXT,
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'UNCONFIGURED',
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_disconnected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS restart_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error_code TEXT;

-- Existing rows predate provider_type/source_family. Preserve them and infer
-- only conservative compatibility values. Provider-specific upgrades can be
-- made later through the admin/configuration path.
UPDATE public.source_connections
SET provider_type = COALESCE(provider_type, source_type),
    source_family = COALESCE(
        source_family,
        CASE
            WHEN LOWER(source_type) IN ('telegram', 'telethon', 'mtproto', 'mtcute') THEN 'telegram'
            WHEN LOWER(source_type) IN ('tradingview', 'tradingview_webhook') THEN 'tradingview'
            WHEN LOWER(source_type) IN ('mt5', 'mt5_bridge', 'mt5_source_bridge') THEN 'mt5'
            WHEN LOWER(source_type) IN ('ctrader', 'ctrader_source') THEN 'ctrader'
            ELSE 'custom_api'
        END
    )
WHERE provider_type IS NULL OR source_family IS NULL;

ALTER TABLE public.source_connections
    ALTER COLUMN source_family SET NOT NULL,
    ALTER COLUMN provider_type SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_connections_workspace_family_active
    ON public.source_connections(workspace_id, source_family, is_active, priority, id);

CREATE INDEX IF NOT EXISTS idx_source_connections_provider_type
    ON public.source_connections(provider_type)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_source_connections_external_identity
    ON public.source_connections(workspace_id, source_family, external_identity)
    WHERE external_identity IS NOT NULL;

-- One preferred source per family. Other enabled sources in the same family
-- remain active and continue to ingest events.
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_one_default_per_family
    ON public.source_connections(workspace_id, source_family)
    WHERE is_active = TRUE AND is_default = TRUE;

-- Atomic preference switch used by the Trading admin layer. The function
-- validates the target before clearing the previous preference, so a bad source
-- ID cannot silently leave the workspace with a changed configuration.
CREATE OR REPLACE FUNCTION public.trading_set_default_source(
    p_workspace_id UUID,
    p_source_family TEXT,
    p_source_id UUID
)
RETURNS public.source_connections
LANGUAGE plpgsql
AS $$
DECLARE
    target public.source_connections;
BEGIN
    SELECT * INTO target
    FROM public.source_connections
    WHERE id = p_source_id
      AND workspace_id = p_workspace_id
      AND source_family = p_source_family
      AND is_active = TRUE
    FOR UPDATE;

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'source not enabled for workspace/family';
    END IF;

    UPDATE public.source_connections
    SET is_default = FALSE,
        updated_at = NOW()
    WHERE workspace_id = p_workspace_id
      AND source_family = p_source_family
      AND is_default = TRUE
      AND id <> p_source_id;

    UPDATE public.source_connections
    SET is_default = TRUE,
        updated_at = NOW()
    WHERE id = p_source_id
    RETURNING * INTO target;

    RETURN target;
END;
$$;

COMMIT;
