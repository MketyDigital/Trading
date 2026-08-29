-- ====================================================================
-- MKETY SAAS PLATFORM & SIGNAL ENGINE DATABASE SCHEMA (SUPABASE SQL)
-- 100% Multi-Tenant, Modular, and Isolated Architecture
-- Supports: app.mkety.com (SaaS Portal) & trade.mkety.com (Copier Engine)
-- ====================================================================

-- Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. WORKSPACES (Multi-Tenant SaaS Accounts)
CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    custom_domain TEXT,
    tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    tg_bot_token TEXT,
    tg_admin_chat_id BIGINT,
    tg_vip_chat_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. LISTENER NODES (Modular @mtcute / MTProto Sockets per Account/Channel)
CREATE TABLE IF NOT EXISTS public.listener_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    node_name TEXT NOT NULL,
    api_id INTEGER NOT NULL,
    api_hash TEXT NOT NULL,
    session_string TEXT,
    source_chat_ids BIGINT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. UNIVERSAL AI PROVIDERS (Dynamic Keys & Models Managed by Workspace Admins)
CREATE TABLE IF NOT EXISTS public.ai_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    provider_name TEXT NOT NULL CHECK (provider_name IN ('gemini', 'openai', 'cloudflare_ai', 'vertex_ai', 'aws_bedrock', 'deepseek', 'groq', 'custom')),
    api_key TEXT NOT NULL,
    base_url TEXT,
    model_name TEXT NOT NULL,
    priority_rank INTEGER DEFAULT 1,
    temperature NUMERIC DEFAULT 0.1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SIGNAL ROUTES (Source Channel -> AI Engine -> Destination Mapping)
CREATE TABLE IF NOT EXISTS public.signal_routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    route_name TEXT NOT NULL,
    source_chat_id BIGINT NOT NULL,
    destination_chat_id BIGINT,
    destination_type TEXT NOT NULL CHECK (destination_type IN ('telegram_vip', 'deriv_ws', 'ctrader_ws', 'mt5_webhook')),
    custom_footer TEXT DEFAULT '~~~ \n<b>Starpips Forex</b>',
    transform_ai BOOLEAN DEFAULT TRUE,
    route_settings JSONB DEFAULT '{}'::jsonb, -- Custom branding, header, and single entry adjustments per-destination
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TRADE ACCOUNTS (Multi-Client Copier Settings for trade.mkety.com)
CREATE TABLE IF NOT EXISTS public.trade_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    account_label TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('deriv', 'ctrader', 'mt5')),
    account_id TEXT NOT NULL,
    api_token_encrypted TEXT NOT NULL,
    server_name TEXT,
    lot_sizing_type TEXT DEFAULT 'fixed' CHECK (lot_sizing_type IN ('fixed', 'multiplier', 'risk_percent')),
    lot_value NUMERIC DEFAULT 0.01,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. VIP MEMBERS (Telegram Channel/Group Subscription Manager)
CREATE TABLE IF NOT EXISTS public.vip_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    telegram_id BIGINT NOT NULL,
    username TEXT,
    first_name TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'trial', 'banned')),
    trial_used BOOLEAN DEFAULT FALSE,
    subscription_tier TEXT DEFAULT 'monthly' CHECK (subscription_tier IN ('trial', 'monthly', 'quarterly', 'yearly', 'lifetime')),
    expires_at TIMESTAMPTZ NOT NULL,
    invite_link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, telegram_id)
);

-- 7. BANK DEPOSIT RECEIPTS (Manual Bank Transfer Approval Queue)
CREATE TABLE IF NOT EXISTS public.bank_deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    telegram_id BIGINT NOT NULL,
    username TEXT,
    amount NUMERIC NOT NULL,
    currency TEXT DEFAULT 'USD',
    plan_requested TEXT NOT NULL,
    receipt_photo_file_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_notes TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SIGNAL LOGS & DEDUPLICATION LOCKS
CREATE TABLE IF NOT EXISTS public.signal_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    source_chat_id BIGINT NOT NULL,
    source_message_id BIGINT NOT NULL,
    raw_text TEXT,
    ai_provider_used TEXT,
    parsed_action TEXT,
    parsed_symbol TEXT,
    status TEXT DEFAULT 'processed',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_chat_id, source_message_id)
);

-- CREATE INDEXES FOR FAST PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_listener_nodes_workspace ON public.listener_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_signal_routes_source ON public.signal_routes(source_chat_id);
CREATE INDEX IF NOT EXISTS idx_vip_members_expiry ON public.vip_members(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_status ON public.bank_deposits(status);
