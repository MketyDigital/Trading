import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCanonicalSourceEventId } from '../src/sources/canonical_event_id.js';

test('telegram container and durable-object providers converge on one native event id', () => {
  const fromContainer = buildCanonicalSourceEventId({
    sourceFamily: 'telegram',
    accountScope: 'account-42',
    nativeIdentity: { chatId: '-10012345', messageId: '9876' },
  });
  const fromDo = buildCanonicalSourceEventId({
    sourceFamily: 'telegram',
    accountScope: 'account-42',
    nativeIdentity: { chatId: '-10012345', messageId: 9876 },
  });

  assert.equal(fromContainer, 'telegram:account-42:-10012345:9876');
  assert.equal(fromDo, fromContainer);
});

test('tradingview ids are stable and source-family scoped', () => {
  assert.equal(
    buildCanonicalSourceEventId({
      sourceFamily: 'tradingview',
      accountScope: 'strategy-a',
      nativeIdentity: { eventId: 'alert-1001' },
    }),
    'tradingview:strategy-a:alert-1001',
  );
});

test('mt5 and ctrader native transaction ids remain distinct by family', () => {
  assert.equal(
    buildCanonicalSourceEventId({
      sourceFamily: 'mt5',
      accountScope: 'login-1',
      nativeIdentity: { eventId: '555' },
    }),
    'mt5:login-1:555',
  );
  assert.equal(
    buildCanonicalSourceEventId({
      sourceFamily: 'ctrader',
      accountScope: 'account-1',
      nativeIdentity: { eventId: '555' },
    }),
    'ctrader:account-1:555',
  );
});

test('canonical identity rejects missing native telegram ids', () => {
  assert.throws(
    () => buildCanonicalSourceEventId({
      sourceFamily: 'telegram',
      accountScope: 'account-42',
      nativeIdentity: { chatId: '-10012345' },
    }),
    /message/i,
  );
});

test('canonical identity rejects unsupported source families', () => {
  assert.throws(
    () => buildCanonicalSourceEventId({
      sourceFamily: 'unknown',
      accountScope: 'scope',
      nativeIdentity: { eventId: '1' },
    }),
    /unsupported source family/i,
  );
});
