BEGIN;

CREATE TABLE IF NOT EXISTS public.source_feeds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    source_connection_id UUID NOT NULL,
    provider_feed_id TEXT NOT NULL,
    display_name TEXT,
    feed_type TEXT NOT NULL DEFAULT 'telegram_chat',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, source_connection_id, provider_feed_id),
    UNIQUE (workspace_id, id),
    UNIQUE (workspace_id, id, source_connection_id),
    CONSTRAINT source_feeds_workspace_source_fk
        FOREIGN KEY (workspace_id, source_connection_id)
        REFERENCES public.source_connections(workspace_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_feeds_connection
    ON public.source_feeds(workspace_id, source_connection_id, is_active, provider_feed_id);

ALTER TABLE public.source_destination_routes
    ADD COLUMN IF NOT EXISTS source_feed_id UUID;

ALTER TABLE public.source_destination_routes
    DROP CONSTRAINT IF EXISTS source_destination_routes_workspace_source_feed_fk;
ALTER TABLE public.source_destination_routes
    DROP CONSTRAINT IF EXISTS source_destination_routes_workspace_feed_source_fk;

-- A feed-scoped route must reference a feed belonging to the exact source
-- connection on that route. This prevents a caller from pairing a feed from
-- another connection in the same workspace with an otherwise valid route.
ALTER TABLE public.source_destination_routes
    ADD CONSTRAINT source_destination_routes_workspace_feed_source_fk
        FOREIGN KEY (workspace_id, source_feed_id, source_connection_id)
        REFERENCES public.source_feeds(workspace_id, id, source_connection_id)
        ON DELETE CASCADE;

-- The original connection-level uniqueness prevented the same destination from
-- being selected independently by multiple feeds under one Telegram transport.
ALTER TABLE public.source_destination_routes
    DROP CONSTRAINT IF EXISTS source_destination_routes_workspace_id_source_connection_id_destination_id_key;
ALTER TABLE public.source_destination_routes
    DROP CONSTRAINT IF EXISTS source_destination_routes_workspace_id_source_connection_id_dest_key;

-- Preserve one legacy/default route per source connection + destination.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_destination_routes_connection_default
    ON public.source_destination_routes(workspace_id, source_connection_id, destination_id)
    WHERE source_feed_id IS NULL;

-- Allow each logical feed to independently target the same destination.
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_destination_routes_feed_destination
    ON public.source_destination_routes(workspace_id, source_feed_id, destination_id)
    WHERE source_feed_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_feed
    ON public.source_destination_routes(workspace_id, source_feed_id, is_active, priority ASC)
    WHERE source_feed_id IS NOT NULL;

ALTER TABLE public.source_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.source_feeds FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.source_feeds FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.source_feeds TO service_role;

COMMIT;
