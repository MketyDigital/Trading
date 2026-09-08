const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set(['workspace.read', 'members.read', 'members.write', 'sources.read', 'sources.write', 'accounts.read', 'accounts.write', 'operations.read', 'hostnames.read', 'hostnames.write', 'ai.read', 'ai.write', 'branding.read', 'branding.write']),
  admin: new Set(['workspace.read', 'members.read', 'members.write', 'sources.read', 'sources.write', 'accounts.read', 'accounts.write', 'operations.read', 'hostnames.read', 'hostnames.write', 'ai.read', 'ai.write', 'branding.read', 'branding.write']),
  operator: new Set(['workspace.read', 'sources.read', 'sources.write', 'ai.read', 'branding.read']),
  viewer: new Set(['workspace.read', 'sources.read', 'ai.read', 'branding.read']),
});

export function hasTradingPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[String(role ?? '').trim()];
  return Boolean(permissions?.has(String(permission ?? '').trim()));
}
