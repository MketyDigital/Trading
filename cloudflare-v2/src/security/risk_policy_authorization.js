/**
 * Risk policy is a workspace-owner responsibility. Do not reuse accounts.write:
 * that permission is intentionally shared with workspace admins for ordinary
 * account administration and is therefore too broad for risk mutations.
 */
export function isWorkspaceRiskOwner(role) {
  return String(role ?? '').trim().toLowerCase() === 'owner';
}

export function assertWorkspaceRiskOwner(role) {
  if (!isWorkspaceRiskOwner(role)) {
    const error = new Error('RISK_POLICY_OWNER_REQUIRED');
    error.code = 'RISK_POLICY_OWNER_REQUIRED';
    throw error;
  }
}
