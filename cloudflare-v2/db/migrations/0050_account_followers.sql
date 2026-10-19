BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_account_followers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
  follower_account_id uuid NOT NULL REFERENCES public.trade_accounts(id) ON DELETE CASCADE,
  parent_account_id uuid NOT NULL REFERENCES public.trade_accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  lot_multiplier numeric NOT NULL DEFAULT 1 CHECK (lot_multiplier > 0),
  fixed_lot numeric CHECK (fixed_lot IS NULL OR fixed_lot > 0),
  last_source_version text,
  last_state_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, follower_account_id),
  CHECK (follower_account_id <> parent_account_id)
);

CREATE INDEX IF NOT EXISTS idx_trading_account_followers_parent_due
  ON public.trading_account_followers(workspace_id, parent_account_id, enabled, updated_at);
CREATE INDEX IF NOT EXISTS idx_trading_account_followers_follower
  ON public.trading_account_followers(workspace_id, follower_account_id, enabled);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_binding_repair
  ON public.destination_deliveries(status, failure_class, updated_at)
  WHERE status = 'SUCCEEDED' AND failure_class = 'STATE_BINDING_PENDING';

ALTER TABLE public.trading_account_followers ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.trading_account_followers FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_account_followers TO service_role;

COMMIT;
