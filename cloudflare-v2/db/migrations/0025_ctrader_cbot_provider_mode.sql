BEGIN;

ALTER TABLE public.trade_accounts
  DROP CONSTRAINT IF EXISTS trade_accounts_provider_mode_check;

ALTER TABLE public.trade_accounts
  ADD CONSTRAINT trade_accounts_provider_mode_check
  CHECK (provider_mode IN ('legacy', 'ctrader_oauth', 'ctrader_cbot', 'mt5_bridge', 'mt5_cloud')) NOT VALID;

ALTER TABLE public.trade_accounts
  VALIDATE CONSTRAINT trade_accounts_provider_mode_check;

COMMIT;
