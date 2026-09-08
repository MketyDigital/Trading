import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyTradingAccessCodeUse } from '../src/access/trading_access_codes.js';

const now = new Date('2026-09-07T12:00:00.000Z');
const workspaceId = '11111111-1111-4111-8111-111111111111';

function record(overrides = {}) {
  return {
    id: 'code-unbound-1',
    product: 'trading',
    status: 'active',
    workspace_id: workspaceId,
    workspace_display_name: 'Ace Trading Desk',
    owner_email: null,
    role: 'owner',
    entitlements: { brokerModes: ['demo'], liveExecution: false },
    max_redemptions: 1,
    redeemed_count: 0,
    expires_at: '2026-09-08T12:00:00.000Z',
    ...overrides,
  };
}

test('first use of an unbound code derives the owner identity from the supplied email', () => {
  const result = classifyTradingAccessCodeUse(record(), 'First.Owner@Example.com', now);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'access_code_onboarding');
  assert.equal(result.workspace.owner_email, 'first.owner@example.com');
  assert.equal(result.membership.subject, 'access-code:first.owner@example.com');
});

test('once a code is bound, a different owner email cannot reuse it', () => {
  const result = classifyTradingAccessCodeUse(record({
    owner_email: 'first.owner@example.com',
    redeemed_count: 1,
  }), 'other@example.com', now);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCESS_CODE_OWNER_EMAIL_MISMATCH');
});