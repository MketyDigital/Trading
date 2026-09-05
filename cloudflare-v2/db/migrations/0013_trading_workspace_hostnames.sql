BEGIN;

-- Customer custom hostnames are Trading-owned routing metadata. They never grant
-- authorization by themselves; the application still requires a valid Mkety
-- signed access assertion plus exact Trading workspace membership.
CREATE TABLE IF NOT EXISTS public.trading_workspace_hostnames (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    hostname TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hostname),
    CHECK (hostname = lower(hostname)),
    CHECK (hostname = btrim(hostname)),
    CHECK (hostname !~ '\\.$'),
    CHECK (status <> 'active' OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_hostnames_workspace_status
    ON public.trading_workspace_hostnames(workspace_id, status);

REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_hostnames FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_hostnames FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_workspace_hostnames TO service_role;
ALTER TABLE public.trading_workspace_hostnames ENABLE ROW LEVEL SECURITY;

COMMIT;
