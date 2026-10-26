import test from 'node:test';
import assert from 'node:assert/strict';

import { createMketyAdminAccessCodePlan } from '../src/http/v1_mkety_admin_access_codes.js';

test('admin access-code creation preserves crypto receiver for default randomUUID', async () => {
  const originalCrypto = globalThis.crypto;
  const boundCrypto = {
    randomUUID() {
      if (this !== boundCrypto) throw new TypeError('Illegal invocation');
      return '11111111-2222-4333-8444-555555555555';
    },
  };

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: boundCrypto,
  });

  try {
    const plan = await createMketyAdminAccessCodePlan({
      ownerEmail: 'runtime-uuid@example.test',
      workspaceName: 'Runtime UUID Test',
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.workspace.id, '11111111-2222-4333-8444-555555555555');
    assert.match(plan.plainCode, /^TRD-MKETY-/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
});
