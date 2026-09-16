BEGIN;

-- Revoking the current access code is a workspace subscription lock. Historical
-- code rows may still exist for audit/history, but only the code referenced by
-- workspace metadata may lock the workspace. Member-level enable/disable state
-- is deliberately preserved so renewal does not overwrite team administration.
CREATE OR REPLACE FUNCTION public.sync_trading_workspace_access_code_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
BEGIN
    IF NEW.product = 'trading'
       AND NEW.status IS DISTINCT FROM 'active'
       AND OLD.status = 'active' THEN
        UPDATE public.trading_workspace_access
           SET trading_access_enabled = false,
               metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                   'accessLockedAt', v_now,
                   'accessLockReason', 'revoked'
               ),
               updated_at = v_now
         WHERE id = NEW.workspace_id
           AND metadata ->> 'accessCodeId' = NEW.id::text;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trading_access_code_workspace_lock ON public.trading_access_codes;
CREATE TRIGGER trading_access_code_workspace_lock
AFTER UPDATE OF status ON public.trading_access_codes
FOR EACH ROW
EXECUTE FUNCTION public.sync_trading_workspace_access_code_status();

REVOKE ALL ON FUNCTION public.sync_trading_workspace_access_code_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_trading_workspace_access_code_status() FROM anon;
REVOKE ALL ON FUNCTION public.sync_trading_workspace_access_code_status() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_trading_workspace_access_code_status() TO service_role;

-- Reissue/renew rotates the credential on the SAME workspace. All workspace
-- configuration remains in place. Previous active codes are revoked, the new
-- code becomes current, and a subscription-locked workspace is re-enabled.
-- Trading entitlements remain DEMO-only and LIVE execution is never enabled.
CREATE OR REPLACE FUNCTION public.rotate_trading_access_code(
    p_workspace_id UUID,
    p_owner_email TEXT,
    p_workspace_display_name TEXT,
    p_owner_name TEXT,
    p_code_hash TEXT,
    p_entitlements JSONB,
    p_max_redemptions INTEGER,
    p_expires_at TIMESTAMPTZ,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.trading_access_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_workspace public.trading_workspace_access%ROWTYPE;
    v_created public.trading_access_codes%ROWTYPE;
    v_owner_email TEXT := lower(trim(coalesce(p_owner_email, '')));
    v_now TIMESTAMPTZ := now();
    v_workspace_metadata JSONB;
    v_existing_entitlements JSONB;
    v_requested_entitlements JSONB := coalesce(p_entitlements, '{}'::jsonb);
    v_effective_entitlements JSONB;
    v_source_types JSONB;
    v_destinations JSONB;
BEGIN
    SELECT *
      INTO v_workspace
      FROM public.trading_workspace_access
     WHERE id = p_workspace_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_CODE_REISSUE_WORKSPACE_NOT_FOUND';
    END IF;

    IF coalesce(trim(v_workspace.owner_email), '') <> ''
       AND lower(trim(v_workspace.owner_email)) <> v_owner_email THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_CODE_REISSUE_OWNER_MISMATCH';
    END IF;

    IF v_owner_email = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OWNER_EMAIL_REQUIRED';
    END IF;

    v_existing_entitlements := coalesce(v_workspace.metadata -> 'entitlements', '{}'::jsonb);

    SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      INTO v_source_types
      FROM (
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_existing_entitlements -> 'sourceTypes', '[]'::jsonb)) AS existing(value)
        UNION
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_requested_entitlements -> 'sourceTypes', '[]'::jsonb)) AS requested(value)
      ) merged_sources;

    SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      INTO v_destinations
      FROM (
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_existing_entitlements -> 'destinations', '[]'::jsonb)) AS existing(value)
        UNION
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_requested_entitlements -> 'destinations', '[]'::jsonb)) AS requested(value)
      ) merged_destinations;

    v_effective_entitlements := v_existing_entitlements || v_requested_entitlements || jsonb_build_object(
        'customSubdomain', coalesce((v_existing_entitlements ->> 'customSubdomain')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'customSubdomain')::boolean, false),
        'customHostname', coalesce((v_existing_entitlements ->> 'customHostname')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'customHostname')::boolean, false),
        'tradingExecutionDestination', coalesce((v_existing_entitlements ->> 'tradingExecutionDestination')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'tradingExecutionDestination')::boolean, false),
        'telegramDestination', coalesce((v_existing_entitlements ->> 'telegramDestination')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'telegramDestination')::boolean, false),
        'sourceTypes', v_source_types,
        'destinations', v_destinations,
        'brokerModes', jsonb_build_array('demo'),
        'liveExecution', false,
        'maxTeamMembers', greatest(
            coalesce((v_existing_entitlements ->> 'maxTeamMembers')::integer, 1),
            coalesce((v_requested_entitlements ->> 'maxTeamMembers')::integer, 1)
        )
    );

    INSERT INTO public.trading_access_codes (
        code_hash,
        product,
        status,
        workspace_id,
        workspace_display_name,
        owner_email,
        owner_name,
        role,
        entitlements,
        max_redemptions,
        redeemed_count,
        expires_at,
        metadata,
        created_at,
        updated_at
    ) VALUES (
        p_code_hash,
        'trading',
        'active',
        p_workspace_id,
        coalesce(nullif(v_workspace.display_name, ''), p_workspace_display_name),
        coalesce(nullif(v_workspace.owner_email, ''), v_owner_email),
        p_owner_name,
        'owner',
        v_effective_entitlements,
        greatest(coalesce(p_max_redemptions, 1), 1),
        0,
        p_expires_at,
        coalesce(p_metadata, '{}'::jsonb),
        v_now,
        v_now
    )
    RETURNING * INTO v_created;

    UPDATE public.trading_access_codes
       SET status = 'revoked', updated_at = v_now
     WHERE workspace_id = p_workspace_id
       AND status = 'active'
       AND id <> v_created.id;

    v_workspace_metadata := (coalesce(v_workspace.metadata, '{}'::jsonb) - 'accessLockedAt' - 'accessLockReason')
        || jsonb_build_object(
            'accessCodeProvisioned', true,
            'accessCodeId', v_created.id,
            'entitlements', v_effective_entitlements
        );

    UPDATE public.trading_workspace_access
       SET display_name = coalesce(nullif(v_workspace.display_name, ''), p_workspace_display_name),
           owner_email = coalesce(nullif(v_workspace.owner_email, ''), v_owner_email),
           trading_access_enabled = true,
           metadata = v_workspace_metadata,
           updated_at = v_now
     WHERE id = p_workspace_id;

    RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_trading_access_code(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_trading_access_code(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.rotate_trading_access_code(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_trading_access_code(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER, TIMESTAMPTZ, JSONB) TO service_role;

COMMIT;
