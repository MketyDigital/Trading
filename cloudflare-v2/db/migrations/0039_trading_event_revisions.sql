BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_event_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    trading_event_id UUID NOT NULL REFERENCES public.trading_events(id) ON DELETE CASCADE,
    revision_key TEXT NOT NULL,
    event_version TEXT NOT NULL DEFAULT '1.0',
    source_type TEXT NOT NULL,
    source_external_id TEXT,
    external_event_id TEXT NOT NULL,
    occurred_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    raw_text TEXT,
    structured_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    thread JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
    canonical_intent JSONB,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(trading_event_id, revision_key)
);

CREATE INDEX IF NOT EXISTS idx_trading_event_revisions_workspace_created
    ON public.trading_event_revisions(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_event_revisions_event_created
    ON public.trading_event_revisions(trading_event_id, created_at DESC);

ALTER TABLE public.trading_event_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.trading_event_revisions FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_event_revisions TO service_role;

COMMIT;
