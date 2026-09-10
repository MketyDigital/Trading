-- Additive metadata for unified broker-account connection management.
-- Existing trade_accounts remain valid and no execution state is changed.

ALTER TABLE public.trade_accounts
  ADD COLUMN IF NOT EXISTS provider_mode TEXT,
  ADD COLUMN IF NOT EXISTS environment TEXT,
  ADD COLUMN IF NOT EXISTS roles JSONB NOT NULL DEFAULT '["execution"]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.trade_accounts
SET provider_mode = CASE
  WHEN provider_mode IS NOT NULL AND btrim(provider_mode) <> '' THEN provider_mode
  WHEN platform = 'ctrader' THEN 'legacy'
  WHEN platform = 'mt5' THEN 'legacy'
  ELSE 'legacy'
END
WHERE provider_mode IS NULL OR btrim(provider_mode) = '';

ALTER TABLE public.trade_accounts
  ALTER COLUMN provider_mode SET DEFAULT 'legacy',
  ALTER COLUMN provider_mode SET NOT NULL;

ALTER TABLE public.trade_accounts
  ADD CONSTRAINT trade_accounts_provider_mode_check
  CHECK (provider_mode IN ('legacy', 'ctrader_oauth', 'mt5_bridge', 'mt5_cloud')) NOT VALID;

ALTER TABLE public.trade_accounts
  ADD CONSTRAINT trade_accounts_environment_check
  CHECK (environment IS NULL OR environment IN ('demo', 'live')) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS trade_accounts_workspace_platform_mode_account_unique
  ON public.trade_accounts(workspace_id, platform, provider_mode, account_id);

COMMENT ON COLUMN public.trade_accounts.provider_mode IS
  'Connection transport/provider mode. Additive and backward-compatible; does not authorize execution.';
COMMENT ON COLUMN public.trade_accounts.environment IS
  'Broker environment hint: demo or live when known.';
COMMENT ON COLUMN public.trade_accounts.roles IS
  'Workspace roles for one physical account, e.g. source/master and/or execution/destination.';
COMMENT ON COLUMN public.trade_accounts.provider_config IS
  'Non-secret provider configuration only. Credentials remain encrypted in credential_ciphertext and are never exposed.';
