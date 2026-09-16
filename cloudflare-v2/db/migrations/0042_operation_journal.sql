BEGIN;

CREATE TABLE IF NOT EXISTS public.operation_journal (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  trading_event_id UUID REFERENCES public.trading_events(id) ON DELETE SET NULL,
  source_connection_id UUID REFERENCES public.source_connections(id) ON DELETE SET NULL,
  source_feed_id UUID REFERENCES public.source_feeds(id) ON DELETE SET NULL,
  route_id UUID REFERENCES public.source_destination_routes(id) ON DELETE SET NULL,
  destination_id UUID REFERENCES public.trading_destinations(id) ON DELETE SET NULL,
  trade_account_id UUID REFERENCES public.trade_accounts(id) ON DELETE SET NULL,
  ai_provider_id UUID REFERENCES public.ai_providers(id) ON DELETE SET NULL,
  position_group_id UUID REFERENCES public.position_groups(id) ON DELETE SET NULL,
  connector_id TEXT,
  stage TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  failure_class TEXT,
  retryable BOOLEAN,
  summary TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, evidence_key),
  CONSTRAINT operation_journal_stage_check CHECK (stage IN (
    'INGRESS',
    'AUTHORIZATION',
    'INTERPRETATION',
    'AI_PROVIDER',
    'CORRELATION',
    'ROUTE',
    'DESTINATION',
    'BROKER_PLANNING',
    'BROKER_EXECUTION',
    'MANAGEMENT',
    'REPLAY',
    'RECONCILIATION',
    'CONNECTOR',
    'PERSISTENCE'
  )),
  CONSTRAINT operation_journal_status_check CHECK (status IN (
    'SUCCEEDED',
    'FAILED',
    'SKIPPED',
    'BLOCKED',
    'RETRYABLE',
    'UNCERTAIN',
    'INFO'
  ))
);

CREATE INDEX IF NOT EXISTS operation_journal_workspace_time_idx
  ON public.operation_journal(workspace_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS operation_journal_event_time_idx
  ON public.operation_journal(trading_event_id, observed_at)
  WHERE trading_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operation_journal_correlation_time_idx
  ON public.operation_journal(workspace_id, correlation_id, observed_at);

CREATE INDEX IF NOT EXISTS operation_journal_stage_status_time_idx
  ON public.operation_journal(workspace_id, stage, status, observed_at DESC);

ALTER TABLE public.operation_journal ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.operation_journal FROM anon, authenticated;

COMMENT ON TABLE public.operation_journal IS
  'Append-only normalized operational evidence. This table is observability only and never grants retry, resend, routing, broker execution, reconciliation or trading authority.';

COMMIT;
