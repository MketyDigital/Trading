BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_workspace_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    zitadel_subject TEXT NOT NULL,
    trading_role TEXT NOT NULL CHECK (trading_role IN ('owner', 'admin', 'operator', 'viewer')),
    membership_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, zitadel_subject)
);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_subject
    ON public.trading_workspace_memberships(zitadel_subject, membership_enabled);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_workspace
    ON public.trading_workspace_memberships(workspace_id, membership_enabled);

ALTER TABLE public.trading_workspace_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_memberships FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_memberships FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_workspace_memberships TO service_role;

COMMIT;
