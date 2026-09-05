const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set(['workspace.read', 'members.read', 'members.write', 'sources.read', 'sources.write', 'accounts.read', 'accounts.write', 'operations.read', 'hostnames.read', 'hostnames.write']),
  admin: new Set(['workspace.read', 'members.read', 'members.write', 'sources.read', 'sources.write', 'accounts.read', 'accounts.write', 'operations.read', 'hostnames.read', 'hostnames.write']),
  operator: new Set(['workspace.read', 'sources.read', 'sources.write']),
  viewer: new Set(['workspace.read', 'sources.read']),
});

export function hasTradingPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[String(role ?? '').trim()];
  return Boolean(permissions?.has(String(permission ?? '').trim()));
}
