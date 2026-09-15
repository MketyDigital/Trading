BEGIN;

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
        coalesce(p_entitlements, '{}'::jsonb),
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

    v_workspace_metadata := coalesce(v_workspace.metadata, '{}'::jsonb)
        || jsonb_build_object(
            'accessCodeProvisioned', true,
            'accessCodeId', v_created.id,
            'entitlements', coalesce(p_entitlements, '{}'::jsonb)
        );

    UPDATE public.trading_workspace_access
       SET display_name = coalesce(nullif(v_workspace.display_name, ''), p_workspace_display_name),
           owner_email = coalesce(nullif(v_workspace.owner_email, ''), v_owner_email),
           trading_access_enabled = v_workspace.trading_access_enabled IS DISTINCT FROM false,
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
