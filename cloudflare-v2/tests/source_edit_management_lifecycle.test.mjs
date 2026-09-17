import test from 'node:test';
import assert from 'node:assert/strict';

import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { buildEditedSignalManagement } from '../src/execution/source_edit_management.js';

function group(overrides = {}) {
  return {
    id: 'group-1',
    workspaceId: 'ws-1',
    tradeAccountId: 'acct-1',
    sourceInstanceId: 'source-1',
    sourceEventIds: ['telegram:-1001:317'],
    symbol: 'XAUUSD',
    side: 'SELL',
    orderType: 'LIMIT',
    entry: { kind: 'RANGE', min: 4273.25, max: 4279.76 },
    stopLoss: 4380,
    status: 'OPEN',
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.01,
      status: 'OPEN',
      brokerPositionId: 'position-1',
      stopLoss: 4380,
      takeProfit: 4250,
    }],
    ...overrides,
  };
}

function editedEvent(text = 'SELL XAUUSD ENTRY 4273.25-4279.76 SL 4390 TP 4240') {
  return {
    workspace_hint: 'ws-1',
    source: { instance_id: 'source-1' },
    external_event_id: 'telegram:-1001:317',
    text,
    thread: { edited_event_id: 'telegram:-1001:317' },
    metadata: {
      telegram_update_kind: 'edited_message',
      native_identity: { chat_id: '-1001', message_id: '317' },
    },
  };
}

function editedIntent(overrides = {}) {
  return {
    side: 'SELL',
    orderType: 'LIMIT',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'RANGE', min: 4273.25, max: 4279.76 },
    stopLoss: 4390,
    takeProfits: [4240],
    incomplete: false,
    fastEntry: false,
    ...overrides,
  };
}

test('edited source identity matches the existing logical trade instead of duplicate no-action', () => {
  const result = correlateTradingEvent({
    event: editedEvent(),
    interpretation: { status: 'READY', source: 'deterministic', intent: editedIntent() },
    activeGroups: [group()],
  });

  assert.deepEqual(result, { status: 'MATCHED', reason: 'EDIT_TARGET', groupId: 'group-1' });
});

test('edited signal changes existing SL and TP using MODIFY only', () => {
  const result = buildEditedSignalManagement(group(), editedIntent(), { rawText: editedEvent().text });

  assert.equal(result.status, 'MANAGEMENT');
  assert.deepEqual(result.actions, [{
    type: 'MODIFY_POSITION',
    legId: 'leg-1',
    targetIndex: 1,
    brokerPositionId: 'position-1',
    symbol: 'XAUUSD',
    stopLoss: 4390,
    takeProfit: 4240,
  }]);
  assert.equal(result.actions.some((action) => action.type === 'OPEN_POSITION'), false);
});

test('edited signal with no semantic protection change produces no broker action', () => {
  const result = buildEditedSignalManagement(group(), editedIntent({ stopLoss: 4380, takeProfits: [4250] }), {
    rawText: 'SELL XAUUSD ENTRY 4273.25-4279.76 SL 4380 TP 4250\nUpdated formatting only',
  });
  assert.deepEqual(result, { status: 'NO_ACTION', reason: 'EDIT_NO_SEMANTIC_CHANGE', actions: [] });
});

test('omitted protection fields in an edited signal are not interpreted as destructive removal', () => {
  const result = buildEditedSignalManagement(group(), editedIntent({ stopLoss: null, takeProfits: [] }), {
    rawText: 'SELL XAUUSD ENTRY 4273.25-4279.76',
  });
  assert.deepEqual(result, { status: 'NO_ACTION', reason: 'EDIT_NO_SEMANTIC_CHANGE', actions: [] });
});

test('edited signal cannot add a new broker leg when more targets are added than already exist', () => {
  const result = buildEditedSignalManagement(group(), editedIntent({ takeProfits: [4240, 4220] }), {
    rawText: 'SELL XAUUSD ENTRY 4273.25-4279.76 SL 4390 TP1 4240 TP2 4220',
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'EDIT_TARGET_STRUCTURE_CHANGE_UNSUPPORTED');
  assert.deepEqual(result.actions, []);
});

test('edit that changes side, symbol, order type, or entry fails closed instead of mutating another trade', () => {
  for (const intent of [
    editedIntent({ side: 'BUY' }),
    editedIntent({ symbol: { canonical: 'EURUSD' } }),
    editedIntent({ orderType: 'MARKET' }),
    editedIntent({ entry: { kind: 'PRICE', value: 4275 } }),
  ]) {
    const result = buildEditedSignalManagement(group(), intent, { rawText: editedEvent().text });
    assert.equal(result.status, 'NEEDS_REVIEW');
    assert.equal(result.reason, 'EDIT_TRADE_IDENTITY_CHANGED');
    assert.deepEqual(result.actions, []);
  }
});
