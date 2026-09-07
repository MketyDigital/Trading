BEGIN;

-- Preserve each provider's own external_event_id for audit while adding a
-- provider-independent native identity used only when authenticated source
-- metadata can derive one safely.
ALTER TABLE public.trading_events
    ADD COLUMN IF NOT EXISTS canonical_event_id TEXT;

-- Keep the existing (workspace_id, source_connection_id, external_event_id)
-- uniqueness from the foundation migration. This additional partial unique
-- index collapses retries/redundant providers observing the same native event.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_events_workspace_canonical_event
    ON public.trading_events(workspace_id, canonical_event_id)
    WHERE canonical_event_id IS NOT NULL;

COMMIT;
