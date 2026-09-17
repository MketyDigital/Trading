import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1DestinationDeliveryAcceptanceStage } from '../src/destinations/v1_destination_delivery_acceptance.js';
import { buildManagementActions } from '../src/execution/position_group.js';
import { buildEditedSignalManagement } from '../src/execution/source_edit_management.js';
import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';

function telegramLineageSupabaseWithoutParent() {
  let journalRow = null;
  let externalLookup = null;
  return {
    get journalRow() { return journalRow; },
    from(table) {
      if (table === 'trading_events') {
        return {
          select() { return this; },
          eq(column, value) {
            if (column === 'external_event_id') externalLookup = String(value);
            return this;
          },
          async maybeSingle() {
            if (externalLookup === '-1002366787615:2460') return { data: { id: 'current-event' }, error: null };
            return { data: null, error: null };
          },
        };
      }
      if (table === 'destination_deliveries') {
        return {
          select() { return this; }, eq() { return this; }, order() { return this; },
          async limit() { return { data: [], error: null }; },
          async upsert(row) { journalRow = row; return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('forward-as-is sends a reply as standalone when the destination parent mapping is unavailable', async () => {
  const supabase = telegramLineageSupabaseWithoutParent();
  let sent = null;
  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'bot-source-1',
    event: {
      external_event_id: '-1002366787615:2460',
      text: 'We go again',
      thread: { reply_to_event_id: 'telegram:-1002366787615:2459' },
      metadata: { native_identity: { chat_id: '-1002366787615', message_id: '2460' } },
    },
    interpretation: { status: 'NEEDS_REVIEW', reason: 'unsupported AI event type' },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    supabase,
    destinationStore: {
      async listRoutedDestinations() {
        return [{
          id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1003928022251', is_active: true,
          credential_ciphertext: 'cipher', settings: { formattingMode: 'none' }, route_filters: {},
        }];
      },
      async recordDestinationOutcome() {},
    },
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    sendTelegram: async (input) => { sent = input; return { ok: true, status: 200, messageId: 501 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(sent.text, 'We go again');
  assert.equal(sent.replyToMessageId, undefined);
  assert.equal(supabase.journalRow.status, 'SUCCEEDED');
});

function openGroup() {
  return {
    id: 'group-1',
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 4344.65,
    entry: { kind: 'MARKET' },
    stopLoss: 4200,
    legs: [{
      legId: 'leg-1', targetIndex: 1, lots: 0.2, status: 'OPEN', brokerPositionId: '138453790',
      stopLoss: 4200, takeProfit: 4408,
    }],
  };
}

test('SL-only management preserves the existing take profit in the final broker action', () => {
  const [action] = buildManagementActions(openGroup(), { type: 'MOVE_SL', stopLoss: 4250 });
  assert.equal(action.stopLoss, 4250);
  assert.equal(action.takeProfit, 4408);
});

test('TP-only management preserves the existing stop loss in the final broker action', () => {
  const [action] = buildManagementActions(openGroup(), { type: 'CHANGE_TP', takeProfit: 4450 });
  assert.equal(action.takeProfit, 4450);
  assert.equal(action.stopLoss, 4200);
});

test('source edit that adds SL preserves an unchanged existing TP', () => {
  const group = openGroup();
  group.stopLoss = null;
  group.legs[0].stopLoss = null;
  const result = buildEditedSignalManagement(group, {
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' }, entry: { kind: 'MARKET' },
    stopLoss: 4200, takeProfits: [4408],
  }, { rawText: 'Tp 4408\nSL 4200' });
  assert.equal(result.status, 'MANAGEMENT');
  assert.equal(result.actions[0].stopLoss, 4200);
  assert.equal(result.actions[0].takeProfit, 4408);
});

test('relative pip protection wording fails closed instead of executing 15 and 30 as absolute prices', async () => {
  let aiCalled = false;
  const result = await interpretTradingEvent({ text: 'Set SL 15 pips\nAnd tp 30 pips' }, {
    aiRouter: {
      async processSignal() {
        aiCalled = true;
        return { success: true, text: '{"event_type":"NEW_SIGNAL"}' };
      },
    },
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.reason, 'RELATIVE_PIP_PROTECTION_REQUIRES_PRICE_CONTEXT');
  assert.equal(aiCalled, false);
});

test('move SL to entry is deterministic break-even management', async () => {
  const result = await interpretTradingEvent({ text: 'Move SL to entry' });
  assert.equal(result.status, 'MANAGEMENT');
  assert.equal(result.source, 'deterministic');
  assert.deepEqual(result.management, { type: 'MOVE_SL_TO_BE' });
});
