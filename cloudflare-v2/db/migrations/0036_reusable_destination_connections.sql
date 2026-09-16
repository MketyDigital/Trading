BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_destination_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('telegram_bot_api')),
    display_name TEXT NOT NULL,
    credential_ciphertext TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, display_name)
);

CREATE INDEX IF NOT EXISTS idx_trading_destination_connections_workspace
    ON public.trading_destination_connections(workspace_id, provider_type, is_active, created_at ASC);

ALTER TABLE public.trading_destinations
    ADD COLUMN IF NOT EXISTS credential_connection_id UUID;

ALTER TABLE public.trading_destinations
    DROP CONSTRAINT IF EXISTS trading_destinations_workspace_credential_connection_fk;

ALTER TABLE public.trading_destinations
    ADD CONSTRAINT trading_destinations_workspace_credential_connection_fk
        FOREIGN KEY (workspace_id, credential_connection_id)
        REFERENCES public.trading_destination_connections(workspace_id, id)
        ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_trading_destinations_credential_connection
    ON public.trading_destinations(workspace_id, credential_connection_id)
    WHERE credential_connection_id IS NOT NULL;

ALTER TABLE public.trading_destination_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.trading_destination_connections FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_destination_connections FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_destination_connections TO service_role;

COMMIT;
