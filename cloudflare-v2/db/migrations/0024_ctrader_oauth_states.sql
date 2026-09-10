-- Short-lived, single-use cTrader OAuth state records.
-- No broker credentials or OAuth access/refresh tokens are stored here.

CREATE TABLE IF NOT EXISTS public.trading_ctrader_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  requested_roles JSONB NOT NULL DEFAULT '["source"]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trading_ctrader_oauth_states_workspace_expiry_idx
  ON public.trading_ctrader_oauth_states(workspace_id, expires_at DESC);

ALTER TABLE public.trading_ctrader_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trading_ctrader_oauth_states FROM anon;
REVOKE ALL ON TABLE public.trading_ctrader_oauth_states FROM authenticated;
GRANT ALL ON TABLE public.trading_ctrader_oauth_states TO service_role;

COMMENT ON TABLE public.trading_ctrader_oauth_states IS
  'Server-managed short-lived state for cTrader OAuth completion; contains no cTrader client secret or user OAuth tokens.';
