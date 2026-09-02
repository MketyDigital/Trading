BEGIN;

-- Supabase Security Advisor flags mutable function search paths. This RPC uses
-- schema-qualified Trading relations, so pin an empty search_path and preserve
-- the existing SECURITY INVOKER + service-role-only execution boundary.
ALTER FUNCTION public.trading_set_default_source(uuid, text, uuid)
    SET search_path = '';

COMMIT;
