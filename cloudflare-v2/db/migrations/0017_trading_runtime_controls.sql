CREATE TABLE IF NOT EXISTS public.trading_runtime_controls (
  control_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trading_runtime_controls_known_key CHECK (control_key IN ('broker_execution_enabled'))
);

ALTER TABLE public.trading_runtime_controls ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.trading_runtime_controls FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.trading_runtime_controls FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_runtime_controls FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_runtime_controls TO service_role;

INSERT INTO public.trading_runtime_controls (control_key, enabled, metadata, updated_by)
VALUES ('broker_execution_enabled', FALSE, '{"source":"migration-default"}'::jsonb, 'migration')
ON CONFLICT (control_key) DO NOTHING;
