BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_destination_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    template_name TEXT NOT NULL,
    formatting_mode TEXT NOT NULL DEFAULT 'template' CHECK (formatting_mode IN ('none', 'clean', 'template', 'ai_then_fallback')),
    parse_mode TEXT NOT NULL DEFAULT 'HTML' CHECK (parse_mode IN ('HTML', 'Markdown', 'MarkdownV2', 'plain')),
    brand_name TEXT,
    header TEXT,
    footer TEXT,
    disclaimer TEXT,
    emoji_style TEXT NOT NULL DEFAULT 'standard',
    cleanup_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    layout JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, template_name)
);

CREATE INDEX IF NOT EXISTS idx_trading_destination_templates_workspace
    ON public.trading_destination_templates(workspace_id, is_default DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS public.trading_destinations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    destination_type TEXT NOT NULL CHECK (destination_type IN ('telegram', 'broker_account', 'internal_webhook', 'audit_only')),
    display_name TEXT NOT NULL,
    destination_ref TEXT,
    template_id UUID REFERENCES public.trading_destination_templates(id) ON DELETE SET NULL,
    credential_ciphertext TEXT,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    health_status TEXT NOT NULL DEFAULT 'UNCONFIGURED',
    last_delivery_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trading_destinations_workspace
    ON public.trading_destinations(workspace_id, destination_type, is_active, created_at ASC);

CREATE TABLE IF NOT EXISTS public.source_destination_routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    source_connection_id UUID NOT NULL REFERENCES public.source_connections(id) ON DELETE CASCADE,
    destination_id UUID NOT NULL REFERENCES public.trading_destinations(id) ON DELETE CASCADE,
    route_name TEXT,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, source_connection_id, destination_id)
);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_source
    ON public.source_destination_routes(workspace_id, source_connection_id, is_active, priority ASC);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_destination
    ON public.source_destination_routes(workspace_id, destination_id, is_active, priority ASC);

ALTER TABLE public.trading_destination_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_destination_routes ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trading_destination_templates FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_destination_templates FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.trading_destinations FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_destinations FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.source_destination_routes FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.source_destination_routes FROM authenticated;

GRANT ALL PRIVILEGES ON TABLE public.trading_destination_templates TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.trading_destinations TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.source_destination_routes TO service_role;

COMMIT;
