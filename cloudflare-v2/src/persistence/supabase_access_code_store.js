import {
  hashTradingAccessCode,
  validateTradingAccessCodeRecord,
} from '../access/trading_access_codes.js';

function requireSupabase(supabase) {
  if (!supabase?.from) throw new Error('SUPABASE_CLIENT_REQUIRED');
}

function safeMetadata(record = {}, payload = {}) {
  return {
    accessCodeId: record.id,
    accessCodeRedeemed: true,
    accessCodeOnboarding: true,
    requestedSubdomain: payload.requestedSubdomain || null,
    entitlements: record.entitlements || {},
  };
}

export function createTradingAccessCodeStore(supabase) {
  requireSupabase(supabase);

  return {
    async redeem(payload = {}) {
      const codeHash = await hashTradingAccessCode(payload.normalizedCode);
      const { data: record, error } = await supabase
        .from('trading_access_codes')
        .select('*')
        .eq('code_hash', codeHash)
        .maybeSingle();

      if (error) return { ok: false, status: 503, reason: 'ACCESS_CODE_LOOKUP_FAILED' };

      const plan = validateTradingAccessCodeRecord(record, payload.now || new Date());
      if (!plan.ok) return plan;

      const nextRedeemedCount = Number(record.redeemed_count || 0) + 1;
      const { data: redeemedRecord, error: redeemError } = await supabase
        .from('trading_access_codes')
        .update({
          redeemed_count: nextRedeemedCount,
          last_redeemed_at: new Date(payload.now || Date.now()).toISOString(),
          updated_at: new Date(payload.now || Date.now()).toISOString(),
        })
        .eq('id', record.id)
        .eq('redeemed_count', record.redeemed_count || 0)
        .select('*')
        .maybeSingle();

      if (redeemError) return { ok: false, status: 503, reason: 'ACCESS_CODE_REDEMPTION_UPDATE_FAILED' };
      if (!redeemedRecord?.id) return { ok: false, status: 409, reason: 'ACCESS_CODE_REDEMPTION_RACE_LOST' };

      const workspaceRow = {
        id: plan.workspace.id,
        display_name: payload.workspaceName || record.workspace_display_name || plan.workspace.name,
        owner_email: payload.ownerEmail || record.owner_email || plan.workspace.owner_email,
        trading_access_enabled: true,
        metadata: safeMetadata(record, payload),
        updated_at: new Date(payload.now || Date.now()).toISOString(),
      };

      const { data: workspace, error: workspaceError } = await supabase
        .from('trading_workspace_access')
        .upsert(workspaceRow, { onConflict: 'id' })
        .select('*')
        .single();

      if (workspaceError || !workspace?.id) {
        return { ok: false, status: 503, reason: 'ACCESS_CODE_WORKSPACE_UPSERT_FAILED' };
      }

      const membershipRow = {
        workspace_id: workspace.id,
        zitadel_subject: plan.membership.subject,
        trading_role: 'owner',
        membership_enabled: true,
        metadata: safeMetadata(record, payload),
        updated_at: new Date(payload.now || Date.now()).toISOString(),
      };

      const { data: membership, error: membershipError } = await supabase
        .from('trading_workspace_memberships')
        .upsert(membershipRow, { onConflict: 'workspace_id,zitadel_subject' })
        .select('*')
        .single();

      if (membershipError || !membership?.id) {
        return { ok: false, status: 503, reason: 'ACCESS_CODE_MEMBERSHIP_UPSERT_FAILED' };
      }

      await supabase
        .from('trading_access_code_redemptions')
        .insert({
          access_code_id: record.id,
          workspace_id: workspace.id,
          zitadel_subject: plan.membership.subject,
          owner_email: payload.ownerEmail || record.owner_email || null,
          status: 'redeemed',
          metadata: {
            requestedSubdomain: payload.requestedSubdomain || null,
            ownerName: payload.ownerName || record.owner_name || null,
          },
        });

      return {
        ...plan,
        workspace: {
          id: workspace.id,
          name: workspace.display_name || plan.workspace.name,
          owner_email: workspace.owner_email || plan.workspace.owner_email,
        },
      };
    },
  };
}
