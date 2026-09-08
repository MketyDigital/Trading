-- Enterprise launch reconciliation: align production schema with canonical V1 APIs.

ALTER TABLE public.trade_accounts
  ADD COLUMN IF NOT EXISTS server_name TEXT;

ALTER TABLE public.trade_accounts
  ALTER COLUMN fast_entry_policy DROP DEFAULT,
  ALTER COLUMN entry_zone_policy DROP DEFAULT;

ALTER TABLE public.trade_accounts
  ALTER COLUMN fast_entry_policy TYPE JSONB
    USING CASE
      WHEN fast_entry_policy IS NULL OR btrim(fast_entry_policy::text) = '' THEN '{}'::jsonb
      WHEN left(btrim(fast_entry_policy::text), 1) IN ('{', '[') THEN fast_entry_policy::jsonb
      ELSE jsonb_build_object('mode', fast_entry_policy::text)
    END,
  ALTER COLUMN entry_zone_policy TYPE JSONB
    USING CASE
      WHEN entry_zone_policy IS NULL OR btrim(entry_zone_policy::text) = '' THEN '{}'::jsonb
      WHEN left(btrim(entry_zone_policy::text), 1) IN ('{', '[') THEN entry_zone_policy::jsonb
      ELSE jsonb_build_object('mode', entry_zone_policy::text)
    END;

ALTER TABLE public.trade_accounts
  ALTER COLUMN fast_entry_policy SET DEFAULT '{}'::jsonb,
  ALTER COLUMN entry_zone_policy SET DEFAULT '{}'::jsonb;

ALTER TABLE public.ai_providers
  ADD COLUMN IF NOT EXISTS api_key_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS temperature NUMERIC NOT NULL DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS max_output_tokens INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS account_id TEXT,
  ADD COLUMN IF NOT EXISTS uses_binding BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS ai_providers_workspace_priority_idx
  ON public.ai_providers(workspace_id, is_active, priority_rank);
