BEGIN;

CREATE TABLE IF NOT EXISTS public.orphan_signal_recovery_cursors (
  cursor_key TEXT PRIMARY KEY,
  last_received_at TIMESTAMPTZ,
  last_event_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orphan_signal_recovery_cursor_pair_check CHECK (
    (last_received_at IS NULL AND last_event_id IS NULL)
    OR (last_received_at IS NOT NULL AND last_event_id IS NOT NULL)
  )
);

ALTER TABLE public.orphan_signal_recovery_cursors ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.orphan_signal_recovery_cursors FROM anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.orphan_signal_recovery_cursors TO service_role;

COMMENT ON TABLE public.orphan_signal_recovery_cursors IS
  'Service-role-only durable keyset cursor for bounded orphan signal recovery scans.';

COMMIT;
