BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_operation_journal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    trading_event_id UUID,
    source_connection_id UUID,
    source_feed_id UUID,
    route_id UUID,
    destination_id UUID,
    destination_delivery_id UUID,
    trade_account_id UUID,
    position_group_id UUID,
    ai_provider_id UUID,
    runtime_group_id TEXT,
    correlation_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    retryable BOOLEAN,
    customer_message TEXT,
    diagnostic JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT trading_operation_journal_stage_check CHECK (stage IN (
      'INGRESS','AUTHORIZATION','NORMALIZATION','INTERPRETATION','AI_PROVIDER',
      'SOURCE_RESOLUTION','ROUTING','DESTINATION','TELEGRAM','BROKER_PLANNING',
      'BROKER_EXECUTION','MANAGEMENT','REPLAY','RECONCILIATION','CONNECTOR','PERSISTENCE'
    )),
    CONSTRAINT trading_operation_journal_status_check CHECK (status IN (
      'PENDING','SUCCEEDED','FAILED','SKIPPED','BLOCKED','NEEDS_REVIEW','REPAIR_REQUIRED'
    ))
);

CREATE INDEX IF NOT EXISTS idx_trading_operation_journal_workspace_time
    ON public.trading_operation_journal(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_operation_journal_event_time
    ON public.trading_operation_journal(trading_event_id, occurred_at DESC)
    WHERE trading_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trading_operation_journal_correlation_time
    ON public.trading_operation_journal(correlation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_operation_journal_stage_status_time
    ON public.trading_operation_journal(stage, status, occurred_at DESC);

ALTER TABLE public.trading_operation_journal ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trading_operation_journal FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_operation_journal FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_operation_journal TO service_role;

COMMIT;
