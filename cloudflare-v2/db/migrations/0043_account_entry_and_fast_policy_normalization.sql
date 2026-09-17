BEGIN;

UPDATE public.trade_accounts
SET fast_entry_policy = '{"enabled":true,"mode":"execute_immediately","locked":true}'::jsonb
WHERE fast_entry_policy IS NULL
   OR fast_entry_policy = '{}'::jsonb
   OR COALESCE(fast_entry_policy->>'mode', '') <> 'execute_immediately'
   OR COALESCE((fast_entry_policy->>'enabled')::boolean, false) IS DISTINCT FROM true
   OR COALESCE((fast_entry_policy->>'locked')::boolean, false) IS DISTINCT FROM true;

UPDATE public.trade_accounts
SET entry_zone_policy = '{"mode":"market_if_inside"}'::jsonb
WHERE entry_zone_policy IS NULL
   OR entry_zone_policy = '{}'::jsonb
   OR COALESCE(entry_zone_policy->>'mode', '') NOT IN (
     'market_if_inside',
     'midpoint',
     'lower',
     'upper',
     'market_only'
   );

COMMIT;
