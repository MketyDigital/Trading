-- Connected DEMO execution accounts are deliberately always available for
-- broker acceptance and customer simulation. This invariant never enables
-- live-money execution and keeps pending/unpaired connector rows fail-closed.

CREATE OR REPLACE FUNCTION public.enforce_connected_demo_execution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  has_execution_role boolean;
  connected_demo boolean;
BEGIN
  has_execution_role := COALESCE(NEW.roles, '[]'::jsonb) ? 'execution';
  connected_demo :=
    lower(COALESCE(NEW.environment, '')) = 'demo'
    AND NULLIF(btrim(COALESCE(NEW.account_id, '')), '') IS NOT NULL
    AND lower(COALESCE(NEW.account_id, '')) NOT LIKE 'pending:%'
    AND (
      lower(COALESCE(NEW.provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
      OR lower(COALESCE(NEW.provider_config->>'status', '')) = 'connected'
    );

  IF connected_demo THEN
    NEW.is_active := true;
    NEW.live_execution_enabled := false;
    IF has_execution_role THEN
      NEW.execution_enabled := true;
      NEW.safety_policy := jsonb_set(
        COALESCE(NEW.safety_policy, '{}'::jsonb),
        '{killSwitch}',
        'false'::jsonb,
        true
      );
    ELSE
      NEW.execution_enabled := false;
      NEW.safety_policy := jsonb_set(
        COALESCE(NEW.safety_policy, '{}'::jsonb),
        '{killSwitch}',
        'true'::jsonb,
        true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trade_accounts_connected_demo_execution_invariant ON public.trade_accounts;
CREATE TRIGGER trade_accounts_connected_demo_execution_invariant
BEFORE INSERT OR UPDATE ON public.trade_accounts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_connected_demo_execution();

-- Repair already-connected demo rows, including any account that an older
-- admin flow allowed to disable. The trigger applies the invariant.
UPDATE public.trade_accounts
SET environment = environment
WHERE lower(COALESCE(environment, '')) = 'demo'
  AND NULLIF(btrim(COALESCE(account_id, '')), '') IS NOT NULL
  AND lower(COALESCE(account_id, '')) NOT LIKE 'pending:%'
  AND (
    lower(COALESCE(provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
    OR lower(COALESCE(provider_config->>'status', '')) = 'connected'
  );
