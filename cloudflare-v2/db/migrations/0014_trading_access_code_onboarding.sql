BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_access_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_hash TEXT NOT NULL UNIQUE,
    product TEXT NOT NULL DEFAULT 'trading' CHECK (product = 'trading'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    workspace_display_name TEXT,
    owner_email TEXT,
    owner_name TEXT,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role = 'owner'),
    entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_redemptions INTEGER NOT NULL DEFAULT 1 CHECK (max_redemptions > 0),
    redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
    expires_at TIMESTAMPTZ,
    last_redeemed_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_access_codes_status_expiry
    ON public.trading_access_codes(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_trading_access_codes_workspace
    ON public.trading_access_codes(workspace_id);

CREATE TABLE IF NOT EXISTS public.trading_access_code_redemptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    access_code_id UUID NOT NULL REFERENCES public.trading_access_codes(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    zitadel_subject TEXT NOT NULL,
    owner_email TEXT,
    status TEXT NOT NULL DEFAULT 'redeemed' CHECK (status IN ('redeemed', 'rejected')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_access_code_redemptions_code
    ON public.trading_access_code_redemptions(access_code_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_access_code_redemptions_workspace
    ON public.trading_access_code_redemptions(workspace_id, created_at DESC);

ALTER TABLE public.trading_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_access_code_redemptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trading_access_codes FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_access_codes FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.trading_access_code_redemptions FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_access_code_redemptions FROM authenticated;

GRANT ALL PRIVILEGES ON TABLE public.trading_access_codes TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.trading_access_code_redemptions TO service_role;

COMMIT;
