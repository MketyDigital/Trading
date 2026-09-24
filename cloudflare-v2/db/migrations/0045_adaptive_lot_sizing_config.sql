-- Additive per-account sizing configuration.
-- Existing fixed sizing rows remain unchanged.
ALTER TABLE public.trade_accounts
  ADD COLUMN IF NOT EXISTS lot_sizing_config JSONB NOT NULL DEFAULT '{}'::jsonb;
