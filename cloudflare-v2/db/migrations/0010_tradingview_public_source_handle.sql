BEGIN;

ALTER TABLE public.source_connections
    ADD COLUMN IF NOT EXISTS public_source_handle TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_public_source_handle
    ON public.source_connections(public_source_handle)
    WHERE public_source_handle IS NOT NULL;

COMMIT;
