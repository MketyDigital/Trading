import test from 'node:test';
import assert from 'node:assert/strict';
import { hasTradingPermission } from '../src/security/trading_permissions.js';

test('workspace role permissions are explicit and fail closed', () => {
  assert.equal(hasTradingPermission('owner', 'members.write'), true);
  assert.equal(hasTradingPermission('admin', 'members.write'), true);
  assert.equal(hasTradingPermission('operator', 'members.write'), false);
  assert.equal(hasTradingPermission('operator', 'sources.write'), true);
  assert.equal(hasTradingPermission('viewer', 'sources.read'), true);
  assert.equal(hasTradingPermission('viewer', 'sources.write'), false);
  assert.equal(hasTradingPermission('owner', 'hostnames.read'), true);
  assert.equal(hasTradingPermission('owner', 'hostnames.write'), true);
  assert.equal(hasTradingPermission('admin', 'hostnames.write'), true);
  assert.equal(hasTradingPermission('operator', 'hostnames.read'), false);
  assert.equal(hasTradingPermission('operator', 'hostnames.write'), false);
  assert.equal(hasTradingPermission('viewer', 'hostnames.read'), false);
  assert.equal(hasTradingPermission('unknown', 'workspace.read'), false);
  assert.equal(hasTradingPermission('owner', 'broker.execute'), false);
});
