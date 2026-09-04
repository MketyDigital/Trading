-- Repoint Trading broker-account tenancy away from the shared MKSaaS workspace
-- lifecycle. This migration is intentionally data-preserving: it neither
-- creates Trading workspaces nor rewrites existing trade_accounts.workspace_id
-- values. Any unprovisioned workspace fails closed before constraint DDL.

DO $$
DECLARE
  legacy_constraint RECORD;
  target_constraint RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.trade_accounts ta
    LEFT JOIN public.trading_workspace_access twa
      ON twa.id = ta.workspace_id
    WHERE ta.workspace_id IS NOT NULL
      AND twa.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'trade_accounts contains workspace_id values not provisioned in trading_workspace_access';
  END IF;

  -- Discover and remove only the exact single-column legacy FK from
  -- trade_accounts.workspace_id to the shared public.workspaces table. Do not
  -- assume a historical constraint name and do not touch unrelated FKs.
  FOR legacy_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.trade_accounts'::regclass
      AND c.confrelid = 'public.workspaces'::regclass
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'workspace_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.trade_accounts DROP CONSTRAINT %I',
      legacy_constraint.conname
    );
  END LOOP;

  -- A rerun may encounter the desired Trading-owned FK already present. Accept
  -- it only when it has the reviewed RESTRICT delete semantics; otherwise fail
  -- closed instead of silently inheriting a different lifecycle contract.
  SELECT c.conname, c.confdeltype
    INTO target_constraint
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f'
    AND c.conrelid = 'public.trade_accounts'::regclass
    AND c.confrelid = 'public.trading_workspace_access'::regclass
    AND array_length(c.conkey, 1) = 1
    AND a.attname = 'workspace_id'
  LIMIT 1;

  IF FOUND THEN
    IF target_constraint.confdeltype <> 'r' THEN
      RAISE EXCEPTION
        'existing trade_accounts Trading workspace FK does not use ON DELETE RESTRICT';
    END IF;
  ELSE
    ALTER TABLE public.trade_accounts
      ADD CONSTRAINT trade_accounts_workspace_id_trading_fkey
      FOREIGN KEY (workspace_id)
      REFERENCES public.trading_workspace_access(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;
