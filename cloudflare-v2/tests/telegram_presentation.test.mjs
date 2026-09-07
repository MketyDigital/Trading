import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTelegramDestination } from '../src/destinations/telegram_presentation.js';

const canonicalSignal = Object.freeze({
  eventId: 'evt-1',
  workspaceId: 'ws-1',
  intent: Object.freeze({
    side: 'BUY',
    symbol: Object.freeze({ canonical: 'XAUUSD', source: 'GOLD' }),
    orderType: 'MARKET',
    entry: Object.freeze({ kind: 'PRICE', value: 2526 }),
    stopLoss: 2518,
    takeProfits: Object.freeze([2530, 2535]),
  }),
});

test('renders a canonical trade deterministically without AI', async () => {
  const result = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { prefix: 'STAR SIGNAL', suffix: 'Manage risk.' } },
  });

  assert.equal(result.mode, 'DETERMINISTIC');
  assert.equal(result.fallbackReason, null);
  assert.match(result.text, /STAR SIGNAL/);
  assert.match(result.text, /BUY XAUUSD/);
  assert.match(result.text, /2526/);
  assert.match(result.text, /SL\s*[:=-]?\s*2518/i);
  assert.match(result.text, /2530/);
  assert.match(result.text, /2535/);
  assert.match(result.text, /Manage risk\./);
});

test('renders deterministic management instructions without AI', async () => {
  const result = await renderTelegramDestination({
    canonicalEvent: {
      eventId: 'evt-mgmt', workspaceId: 'ws-1',
      status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
    },
    destination: { presentation: { prefix: 'UPDATE' } },
    aiFormatter: async () => { throw new Error('AI must not be required'); },
  });

  assert.equal(result.mode, 'DETERMINISTIC');
  assert.match(result.text, /UPDATE/);
  assert.match(result.text, /BREAK.?EVEN|MOVE SL TO BE/i);
});

test('supports deterministic destination branding and field labels without mutating canonical values', async () => {
  const before = JSON.stringify(canonicalSignal);
  const result = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: {
      presentation: {
        prefix: '⚡ ALPHA FX',
        labels: { stopLoss: 'STOP', takeProfit: 'TARGET' },
        fieldOrder: ['sideSymbol', 'takeProfits', 'stopLoss', 'entry'],
      },
    },
  });

  assert.match(result.text, /⚡ ALPHA FX/);
  assert.match(result.text, /TARGET 1.*2530/i);
  assert.match(result.text, /STOP.*2518/i);
  assert.equal(JSON.stringify(canonicalSignal), before);
});

test('uses optional AI presentation only after deterministic content exists', async () => {
  let received;
  const result = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { useAi: true, brandName: 'Alpha FX' } },
    aiFormatter: async (input) => {
      received = input;
      return {
        success: true,
        text: '🔥 Alpha FX BUY XAUUSD | Entry 2526 | SL 2518 | TP 2530 / 2535',
        canonicalEcho: {
          side: 'BUY', symbol: 'XAUUSD', entry: 2526, stopLoss: 2518, takeProfits: [2530, 2535],
        },
      };
    },
  });

  assert.equal(result.mode, 'AI');
  assert.equal(result.fallbackReason, null);
  assert.match(received.deterministicText, /BUY XAUUSD/);
  assert.equal(received.brandName, 'Alpha FX');
});

test('AI failure, timeout, or unavailable provider falls back immediately to deterministic presentation', async () => {
  const failed = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { useAi: true } },
    aiFormatter: async () => ({ success: false, error: 'provider down' }),
  });
  assert.equal(failed.mode, 'DETERMINISTIC');
  assert.equal(failed.fallbackReason, 'AI_FAILED');
  assert.match(failed.text, /BUY XAUUSD/);

  const unavailable = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { useAi: true } },
  });
  assert.equal(unavailable.mode, 'DETERMINISTIC');
  assert.equal(unavailable.fallbackReason, 'AI_UNAVAILABLE');

  const timeout = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { useAi: true } },
    timeoutMs: 5,
    aiFormatter: async () => new Promise(() => {}),
  });
  assert.equal(timeout.mode, 'DETERMINISTIC');
  assert.equal(timeout.fallbackReason, 'AI_TIMEOUT');
});

test('AI cannot change canonical trade semantics and mismatch falls back deterministically', async () => {
  const before = JSON.stringify(canonicalSignal);
  const result = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { useAi: true } },
    aiFormatter: async () => ({
      success: true,
      text: 'SELL XAUUSD SL 2600 TP 2400',
      canonicalEcho: {
        side: 'SELL', symbol: 'XAUUSD', entry: 2526, stopLoss: 2600, takeProfits: [2400],
      },
    }),
  });

  assert.equal(result.mode, 'DETERMINISTIC');
  assert.equal(result.fallbackReason, 'AI_CANONICAL_MISMATCH');
  assert.match(result.text, /BUY XAUUSD/);
  assert.equal(JSON.stringify(canonicalSignal), before);
});

test('malformed AI output falls back without exposing arbitrary provider errors', async () => {
  const result = await renderTelegramDestination({
    canonicalEvent: canonicalSignal,
    destination: { presentation: { useAi: true } },
    aiFormatter: async () => ({ success: true, text: '' }),
  });
  assert.equal(result.mode, 'DETERMINISTIC');
  assert.equal(result.fallbackReason, 'AI_INVALID_OUTPUT');
  assert.doesNotMatch(JSON.stringify(result), /secret|token|provider down/i);
});
