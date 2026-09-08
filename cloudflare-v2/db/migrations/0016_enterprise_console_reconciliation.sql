-- Enterprise launch reconciliation: align production schema with canonical V1 APIs.

ALTER TABLE public.trade_accounts
  ADD COLUMN IF NOT EXISTS server_name TEXT;

-- Legacy policy columns were text enums with CHECK constraints. The canonical
-- V1 account API stores structured policy objects, so remove the old enum
-- constraints before converting them to JSONB.
ALTER TABLE public.trade_accounts
  DROP CONSTRAINT IF EXISTS trade_accounts_fast_entry_policy_check,
  DROP CONSTRAINT IF EXISTS trade_accounts_entry_zone_policy_check;

ALTER TABLE public.trade_accounts
  ALTER COLUMN fast_entry_policy DROP DEFAULT,
  ALTER COLUMN entry_zone_policy DROP DEFAULT;

ALTER TABLE public.trade_accounts
  ALTER COLUMN fast_entry_policy TYPE JSONB
    USING CASE
      WHEN fast_entry_policy IS NULL OR btrim(fast_entry_policy::text) = '' THEN '{}'::jsonb
      WHEN left(btrim(fast_entry_policy::text), 1) IN ('{', '[') THEN fast_entry_policy::text::jsonb
      ELSE jsonb_build_object('mode', fast_entry_policy::text)
    END,
  ALTER COLUMN entry_zone_policy TYPE JSONB
    USING CASE
      WHEN entry_zone_policy IS NULL OR btrim(entry_zone_policy::text) = '' THEN '{}'::jsonb
      WHEN left(btrim(entry_zone_policy::text), 1) IN ('{', '[') THEN entry_zone_policy::text::jsonb
      ELSE jsonb_build_object('mode', entry_zone_policy::text)
    END;

ALTER TABLE public.trade_accounts
  ALTER COLUMN fast_entry_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN entry_zone_policy SET DEFAULT '{}'::jsonb;

-- ai_providers predates Trading V1 and was still bound to the legacy workspaces table.
-- Production currently has no AI provider rows, so the FK can be safely reconciled
-- before customer self-service AI configuration is enabled.
ALTER TABLE public.ai_providers
  DROP CONSTRAINT IF EXISTS ai_providers_workspace_id_fkey,
  DROP CONSTRAINT IF EXISTS ai_providers_workspace_id_trading_fkey;

ALTER TABLE public.ai_providers
  ADD CONSTRAINT ai_providers_workspace_id_trading_fkey
  FOREIGN KEY (workspace_id)
  REFERENCES public.trading_workspace_access(id)
  ON DELETE CASCADE;

ALTER TABLE public.ai_providers
  ADD COLUMN IF NOT EXISTS api_key_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS temperature NUMERIC NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS max_output_tokens INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS account_id TEXT,
  ADD COLUMN IF NOT EXISTS uses_binding BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS ai_providers_workspace_priority_idx
  ON public.ai_providers(workspace_id, is_active, priority_rank);
