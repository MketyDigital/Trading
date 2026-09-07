import { createClient } from '@supabase/supabase-js';
import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';
import { hasTradingPermission } from '../src/security/trading_permissions.js';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`Missing Gate 4 configuration: ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function disabled(value) {
  return !['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

const baseUrl = required('GATE4_BASE_URL').replace(/\/+$/, '');
const workspaceId = required('GATE4_WORKSPACE_ID');
const secondWorkspaceId = required('GATE4_SECOND_WORKSPACE_ID');
const disabledWorkspaceId = required('GATE4_DISABLED_WORKSPACE_ID');

const env = {
  ZITADEL_ISSUER: required('ZITADEL_ISSUER'),
  ZITADEL_AUDIENCE: required('ZITADEL_AUDIENCE'),
  ZITADEL_JWKS_URL: required('ZITADEL_JWKS_URL'),
  ZITADEL_PROJECT_ID: required('ZITADEL_PROJECT_ID'),
  ZITADEL_TRADING_ROLE: process.env.ZITADEL_TRADING_ROLE || 'trading_access',
};

assert(disabled(process.env.TRADING_ACCESS_ENABLED), 'TRADING_ACCESS_ENABLED must remain false during Gate 4 acceptance');
assert(disabled(process.env.BROKER_EXECUTION_ENABLED), 'broker execution must remain disabled during Gate 4 acceptance');

const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function requestFor(token, selectedWorkspaceId) {
  return new Request(`${baseUrl}/api/v1/admin/workspace`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': selectedWorkspaceId,
    },
  });
}

async function authorize(label, token, selectedWorkspaceId = workspaceId) {
  const result = await authorizeV1AdminRequest(requestFor(token, selectedWorkspaceId), env, { supabase });
  return { label, result };
}

function expectAllowed(label, result, role) {
  assert(result?.ok === true, `${label} should be authorized`);
  assert(result.membership?.enabled === true, `${label} membership must be enabled`);
  assert(result.membership?.role === role, `${label} expected Trading role ${role}`);
  return result;
}

function expectDenied(label, result, reasons = []) {
  assert(result?.ok === false, `${label} must be denied`);
  if (reasons.length > 0) {
    assert(reasons.includes(result.reason), `${label} denied for unexpected reason ${result.reason}`);
  }
}

const tokens = {
  existingMkety: required('GATE4_EXISTING_MKETY_TOKEN'),
  tradingOnly: required('GATE4_TRADING_ONLY_TOKEN'),
  wrongProject: required('GATE4_WRONG_PROJECT_TOKEN'),
  wrongOrg: required('GATE4_WRONG_ORG_TOKEN'),
  missingMembership: required('GATE4_MISSING_MEMBERSHIP_TOKEN'),
  disabledMembership: required('GATE4_DISABLED_MEMBERSHIP_TOKEN'),
  secondTenant: required('GATE4_SECOND_TENANT_TOKEN'),
  owner: required('GATE4_OWNER_TOKEN'),
  admin: required('GATE4_ADMIN_TOKEN'),
  operator: required('GATE4_OPERATOR_TOKEN'),
  viewer: required('GATE4_VIEWER_TOKEN'),
};

const acceptedExisting = expectAllowed(
  'existing-Mkety identity',
  (await authorize('existing-Mkety identity', tokens.existingMkety)).result,
  process.env.GATE4_EXISTING_MKETY_ROLE || 'owner',
);

expectAllowed(
  'Trading-only identity',
  (await authorize('Trading-only identity', tokens.tradingOnly)).result,
  process.env.GATE4_TRADING_ONLY_ROLE || 'viewer',
);

expectDenied(
  'wrong-project identity',
  (await authorize('wrong-project identity', tokens.wrongProject)).result,
  ['ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG'],
);
expectDenied(
  'wrong-org identity',
  (await authorize('wrong-org identity', tokens.wrongOrg)).result,
  ['ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG'],
);
expectDenied(
  'missing-membership identity',
  (await authorize('missing-membership identity', tokens.missingMembership)).result,
  ['TRADING_MEMBERSHIP_DISABLED_OR_MISSING'],
);
expectDenied(
  'disabled-membership identity',
  (await authorize('disabled-membership identity', tokens.disabledMembership)).result,
  ['TRADING_MEMBERSHIP_DISABLED_OR_MISSING'],
);
expectDenied(
  'disabled-entitlement workspace',
  (await authorize('disabled-entitlement workspace', tokens.existingMkety, disabledWorkspaceId)).result,
  ['TRADING_ACCESS_DISABLED'],
);

const roleCases = [
  ['owner', tokens.owner],
  ['admin', tokens.admin],
  ['operator', tokens.operator],
  ['viewer', tokens.viewer],
];
for (const [role, token] of roleCases) {
  const auth = expectAllowed(`${role} role`, (await authorize(`${role} role`, token)).result, role);
  assert(hasTradingPermission(auth.membership.role, 'workspace.read'), `${role} must retain workspace.read`);
  assert(!hasTradingPermission(auth.membership.role, 'broker.execute'), `${role} must never receive broker.execute`);
}
assert(hasTradingPermission('owner', 'accounts.write'), 'owner account administration contract missing');
assert(hasTradingPermission('admin', 'accounts.write'), 'admin account administration contract missing');
assert(!hasTradingPermission('operator', 'accounts.write'), 'operator must not receive account control');
assert(!hasTradingPermission('viewer', 'sources.write'), 'viewer must remain read only');

expectAllowed(
  'second-tenant identity in second workspace',
  (await authorize('second-tenant identity in second workspace', tokens.secondTenant, secondWorkspaceId)).result,
  process.env.GATE4_SECOND_TENANT_ROLE || 'owner',
);
expectDenied(
  'tenant-isolation A token against second workspace',
  (await authorize('tenant-isolation A token against second workspace', tokens.existingMkety, secondWorkspaceId)).result,
  ['ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG', 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING'],
);
expectDenied(
  'tenant-isolation B token against primary workspace',
  (await authorize('tenant-isolation B token against primary workspace', tokens.secondTenant, workspaceId)).result,
  ['ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG', 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING'],
);

assert(acceptedExisting.auth?.subject, 'accepted identity must be bound by immutable Zitadel sub');

console.log(JSON.stringify({
  ok: true,
  gate: 4,
  identityPlane: 'Mkety Zitadel',
  tradingAccessMasterFuse: false,
  brokerExecution: false,
  checks: [
    'existing-Mkety',
    'Trading-only',
    'wrong-project',
    'wrong-org',
    'missing-membership',
    'disabled-membership',
    'disabled-entitlement',
    'owner/admin/operator/viewer',
    'broker execution separation',
    'second-tenant isolation',
  ],
}));
