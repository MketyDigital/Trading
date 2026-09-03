import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchDestinationFanout } from '../src/destinations/destination_fanout.js';

const event = {
  id: 'evt-telegram-1',
  workspaceId: 'ws-a',
  intent: {
    side: 'BUY',
    symbol: { canonical: 'XAUUSD' },
    orderType: 'MARKET',
    entry: { kind: 'PRICE', value: 2526 },
    stopLoss: 2518,
    takeProfits: [2530, 2535],
  },
};

function telegram(id, presentation = {}, workspaceId = 'ws-a') {
  return { id, workspaceId, type: 'telegram', presentation, config: { chatId: `chat-${id}` } };
}

test('Telegram AI failure falls back deterministically and still dispatches the signal', async () => {
  let seen;
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [telegram('tg-1', { useAi: true, prefix: 'STAR SIGNAL' })],
    event,
    aiFormatter: async () => ({ success: false, error: 'provider-secret-error' }),
    dispatch: async (input) => {
      seen = input;
      return { success: true, deliveryRef: 'msg-1' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.succeeded, 1);
  assert.equal(seen.presentation.mode, 'DETERMINISTIC');
  assert.equal(seen.presentation.fallbackReason, 'AI_FAILED');
  assert.match(seen.presentation.text, /STAR SIGNAL/);
  assert.match(seen.presentation.text, /BUY XAUUSD/);
  assert.equal(JSON.stringify(result).includes('provider-secret-error'), false);
});

test('one Telegram network failure cannot block a sibling Telegram destination', async () => {
  const calls = [];
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [telegram('tg-a'), telegram('tg-b')],
    event,
    dispatch: async ({ destination, presentation }) => {
      calls.push([destination.id, presentation.text]);
      if (destination.id === 'tg-a') throw new Error('telegram network unavailable');
      return { success: true, deliveryRef: 'msg-b' };
    },
  });

  assert.deepEqual(calls.map(([id]) => id).sort(), ['tg-a', 'tg-b']);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.outcomes.map((item) => [item.destinationId, item.status]), [
    ['tg-a', 'FAILED'],
    ['tg-b', 'SUCCEEDED'],
  ]);
});

test('destination dispatcher receives no broker cancellation or execution authority', async () => {
  let keys = [];
  await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [telegram('tg-safe')],
    event,
    dispatch: async (input) => {
      keys = Object.keys(input).sort();
      assert.equal('broker' in input, false);
      assert.equal('executor' in input, false);
      assert.equal('cancelExecution' in input, false);
      assert.equal('executionCoordinator' in input, false);
      return { success: true };
    },
  });

  assert.deepEqual(keys, ['destination', 'event', 'presentation', 'workspaceId']);
});

test('non-Telegram destinations preserve the existing dispatch contract', async () => {
  let input;
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [{ id: 'sim-1', workspaceId: 'ws-a', type: 'simulation' }],
    event,
    dispatch: async (value) => { input = value; return { success: true }; },
  });

  assert.equal(result.ok, true);
  assert.equal('presentation' in input, false);
});
