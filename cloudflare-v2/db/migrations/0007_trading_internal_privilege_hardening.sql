BEGIN;

-- These Trading-owned tables are server/service-role internals. RLS remains
-- enabled as defense in depth, but anon/authenticated should not have table
-- privileges at all. Keep this migration narrowly scoped: do not alter shared
-- Mkety tables or schema-wide default privileges.

REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_access FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_access FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_workspace_access TO service_role;
ALTER TABLE public.trading_workspace_access ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.source_connections FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.source_connections FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.source_connections TO service_role;
ALTER TABLE public.source_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trading_events FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_events FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_events TO service_role;
ALTER TABLE public.trading_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.position_groups FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.position_groups FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.position_groups TO service_role;
ALTER TABLE public.position_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.position_legs FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.position_legs FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.position_legs TO service_role;
ALTER TABLE public.position_legs ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.destination_deliveries FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.destination_deliveries FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.destination_deliveries TO service_role;
ALTER TABLE public.destination_deliveries ENABLE ROW LEVEL SECURITY;

-- Migration 0003 creates this public SECURITY INVOKER RPC for the server-side
-- source admin layer. Postgres grants function EXECUTE to PUBLIC by default,
-- so make the service-only boundary explicit as well.
REVOKE ALL PRIVILEGES ON FUNCTION public.trading_set_default_source(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION public.trading_set_default_source(uuid, text, uuid) FROM anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.trading_set_default_source(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trading_set_default_source(uuid, text, uuid) TO service_role;

COMMIT;
