BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_ingress_collectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collector_name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_ingress_collectors_active
    ON public.trading_ingress_collectors(is_active, id)
    WHERE is_active = TRUE;

ALTER TABLE public.trading_ingress_collectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trading_ingress_collectors FROM anon, authenticated;
GRANT ALL ON TABLE public.trading_ingress_collectors TO service_role;

COMMENT ON TABLE public.trading_ingress_collectors IS
    'Mkety-owned shared transport identities for forwarding all visible external MTProto messages. Plaintext collector tokens are never stored.';
COMMENT ON COLUMN public.trading_ingress_collectors.token_hash IS
    'SHA-256 hex hash of the collector token; plaintext is shown only at creation or rotation.';

COMMIT;
