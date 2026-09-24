-- Expand lot sizing types without modifying any existing account row.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname
    INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.trade_accounts'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%lot_sizing_type%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.trade_accounts DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.trade_accounts
  ADD CONSTRAINT trade_accounts_lot_sizing_type_check
  CHECK (lot_sizing_type IN (
    'fixed',
    'adaptive_percent',
    'symbol_equivalent',
    'balance_percent',
    'multiplier',
    'risk_percent'
  ));
