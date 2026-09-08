import {
  classifyTradingAccessCodeUse,
  hashTradingAccessCode,
} from '../access/trading_access_codes.js';
import { normalizeTradingEntitlements } from '../security/trading_entitlements.js';

function requireSupabase(supabase) {
  if (!supabase?.from) throw new Error('SUPABASE_CLIENT_REQUIRED');
}

function safeMetadata(record = {}, payload = {}, entitlements = record.entitlements || {}) {
  return {
    accessCodeId: record.id,
    accessCodeRedeemed: true,
    accessCodeOnboarding: true,
    accessCodeProvisioned: true,
    requestedSubdomain: payload.requestedSubdomain || null,
    entitlements,
  };
}

export function createTradingAccessCodeStore(supabase) {
  requireSupabase(supabase);

  async function restoreSession({ workspaceId, subject } = {}) {
    const wid = String(workspaceId || '').trim();
    const sub = String(subject || '').trim();
    if (!wid || !sub) return { ok: false, status: 401, reason: 'RETURNING_SESSION_INVALID' };

    const { data: workspace, error: workspaceError } = await supabase
      .from('trading_workspace_access')
      .select('id,display_name,owner_email,trading_access_enabled,metadata')
      .eq('id', wid)
      .maybeSingle();
    if (workspaceError || !workspace?.id) return { ok: false, status: 401, reason: 'WORKSPACE_ACCESS_NOT_FOUND' };
    if (workspace.trading_access_enabled !== true) return { ok: false, status: 403, reason: 'TRADING_WORKSPACE_DISABLED' };

    const { data: membership, error: membershipError } = await supabase
      .from('trading_workspace_memberships')
      .select('workspace_id,zitadel_subject,trading_role,membership_enabled,metadata')
      .eq('workspace_id', wid)
      .eq('zitadel_subject', sub)
      .maybeSingle();
    if (membershipError || !membership) return { ok: false, status: 401, reason: 'TRADING_MEMBERSHIP_NOT_FOUND' };
    if (membership.membership_enabled !== true || String(membership.trading_role || '') !== 'owner') {
      return { ok: false, status: 403, reason: 'TRADING_OWNER_MEMBERSHIP_REQUIRED' };
    }

    const rawEntitlements = membership.metadata?.entitlements || workspace.metadata?.entitlements || {};
    return {
      ok: true,
      workspace: {
        id: workspace.id,
        name: workspace.display_name || null,
        owner_email: workspace.owner_email || null,
      },
      membership: {
        subject: sub,
        role: 'owner',
        enabled: true,
      },
      entitlements: normalizeTradingEntitlements(rawEntitlements),
    };
  }

  return {
    async redeem(payload = {}) {
      const codeHash = await hashTradingAccessCode(payload.normalizedCode);
      const { data: record, error } = await supabase
        .from('trading_access_codes')
        .select('*')
        .eq('code_hash', codeHash)
        .maybeSingle();

      if (error) return { ok: false, status: 503, reason: 'ACCESS_CODE_LOOKUP_FAILED' };

      const plan = classifyTradingAccessCodeUse(record, payload.ownerEmail, payload.now || new Date());
      if (!plan.ok) return plan;

      if (plan.mode === 'access_code_login') {
        const restored = await restoreSession({
          workspaceId: plan.workspace.id,
          subject: plan.membership.subject,
        });
        return restored.ok ? { ...restored, mode: 'access_code_login' } : restored;
      }

      if (payload.requestedSubdomain && !plan.entitlements.customSubdomain) {
        return { ok: false, status: 403, reason: 'CUSTOM_SUBDOMAIN_ENTITLEMENT_REQUIRED' };
      }

      const nextRedeemedCount = Number(record.redeemed_count || 0) + 1;
      const effectiveOwnerEmail = String(record.owner_email || payload.ownerEmail || '').trim().toLowerCase();
      const { data: redeemedRecord, error: redeemError } = await supabase
        .from('trading_access_codes')
        .update({
          owner_email: effectiveOwnerEmail,
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
        owner_email: effectiveOwnerEmail,
        trading_access_enabled: true,
        metadata: safeMetadata(record, payload, plan.entitlements),
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
        metadata: safeMetadata(record, payload, plan.entitlements),
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
          owner_email: effectiveOwnerEmail,
          status: 'redeemed',
          metadata: {
            requestedSubdomain: payload.requestedSubdomain || null,
            ownerName: payload.ownerName || record.owner_name || null,
          },
        });

      return {
        ...plan,
        mode: 'access_code_onboarding',
        workspace: {
          id: workspace.id,
          name: workspace.display_name || plan.workspace.name,
          owner_email: workspace.owner_email || plan.workspace.owner_email,
        },
      };
    },

    restoreSession,
  };
}