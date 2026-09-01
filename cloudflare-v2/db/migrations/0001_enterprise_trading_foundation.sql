BEGIN;

-- Trading V1 owns its access/entitlement binding. The id is the stable workspace
-- identifier supplied by Mkety/Zitadel control-plane provisioning, but this table
-- deliberately has no foreign key to public.workspaces so Trading can remain
-- independently deployable and this migration never mutates shared Mkety schema.
CREATE TABLE IF NOT EXISTS public.trading_workspace_access (
    id UUID PRIMARY KEY,
    display_name TEXT,
    owner_email TEXT,
    zitadel_org_id TEXT,
    trading_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    trading_required_role TEXT NOT NULL DEFAULT 'trading_access',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_workspace_access_zitadel_org
    ON public.trading_workspace_access(zitadel_org_id)
    WHERE zitadel_org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.source_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_instance_id TEXT NOT NULL,
    display_name TEXT,
    secret_ciphertext TEXT NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, source_instance_id)
);

CREATE TABLE IF NOT EXISTS public.trading_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    source_connection_id UUID NOT NULL REFERENCES public.source_connections(id) ON DELETE CASCADE,
    external_event_id TEXT NOT NULL,
    event_version TEXT NOT NULL DEFAULT '1.0',
    source_type TEXT NOT NULL,
    source_external_id TEXT,
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
    UNIQUE(workspace_id, source_connection_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS public.position_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    trade_account_id UUID REFERENCES public.trade_accounts(id) ON DELETE SET NULL,
    source_event_id UUID REFERENCES public.trading_events(id) ON DELETE SET NULL,
    correlation_key TEXT,
    canonical_symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type TEXT NOT NULL,
    entry JSONB NOT NULL DEFAULT '{}'::jsonb,
    stop_loss NUMERIC,
    status TEXT NOT NULL DEFAULT 'PLANNED',
    risk_plan JSONB,
    policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.position_legs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    position_group_id UUID NOT NULL REFERENCES public.position_groups(id) ON DELETE CASCADE,
    target_index INTEGER NOT NULL CHECK (target_index > 0),
    lots NUMERIC NOT NULL CHECK (lots > 0),
    stop_loss NUMERIC,
    take_profit NUMERIC,
    status TEXT NOT NULL DEFAULT 'PLANNED',
    broker_position_id TEXT,
    broker_order_id TEXT,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(position_group_id, target_index)
);

CREATE TABLE IF NOT EXISTS public.destination_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    trading_event_id UUID REFERENCES public.trading_events(id) ON DELETE SET NULL,
    destination_type TEXT NOT NULL,
    destination_ref TEXT,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    request_payload JSONB,
    response_payload JSONB,
    error_code TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_source_connections_workspace_active
    ON public.source_connections(workspace_id, is_active);
CREATE INDEX IF NOT EXISTS idx_trading_events_workspace_received
    ON public.trading_events(workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_position_groups_workspace_status
    ON public.position_groups(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_position_groups_correlation
    ON public.position_groups(workspace_id, correlation_key)
    WHERE correlation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_position_legs_group_status
    ON public.position_legs(position_group_id, status);
CREATE INDEX IF NOT EXISTS idx_destination_deliveries_status
    ON public.destination_deliveries(workspace_id, status, created_at);

-- These tables live in Supabase's exposed public schema but are service-role-only
-- Trading internals. RLS is defense in depth; no anon/authenticated policies are
-- created by this migration.
ALTER TABLE public.trading_workspace_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destination_deliveries ENABLE ROW LEVEL SECURITY;

COMMIT;
