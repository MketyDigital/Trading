import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkspaceRiskOwner, isWorkspaceRiskOwner } from '../src/security/risk_policy_authorization.js';

test('only the exact workspace owner role may mutate risk policy', () => {
  assert.equal(isWorkspaceRiskOwner('owner'), true);
  assert.equal(isWorkspaceRiskOwner('OWNER'), true);
  for (const role of ['admin', 'operator', 'viewer', '', null, undefined, 'workspace_owner']) {
    assert.equal(isWorkspaceRiskOwner(role), false, `expected ${String(role)} to be denied`);
    assert.throws(() => assertWorkspaceRiskOwner(role), (error) => error?.code === 'RISK_POLICY_OWNER_REQUIRED');
  }
});

