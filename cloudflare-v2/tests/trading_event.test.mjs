import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTradingEvent } from '../src/events/trading_event.js';

test('maps legacy Telegram payload into the universal envelope', () => {
  const result = normalizeTradingEvent({ source_chat_id: -100123, source_message_id: 55, raw_text: 'BUY GOLD NOW', reply_to_message_id: 54 });
  assert.equal(result.ok, true);
  assert.equal(result.event.version, '1.0');
  assert.equal(result.event.source.type, 'telegram_mtproto');
  assert.equal(result.event.source.external_id, '-100123');
  assert.equal(result.event.external_event_id, '55');
  assert.equal(result.event.text, 'BUY GOLD NOW');
  assert.equal(result.event.thread.reply_to_event_id, '54');
});

test('accepts a generic TradingView/custom payload using the same envelope', () => {
  const result = normalizeTradingEvent({
    version: '1.0',
    source: { type: 'tradingview', instance_id: 'tv-main', external_id: 'alert-1' },
    external_event_id: 'evt-99',
    text: 'SELL EURUSD 1.0830 SL 1.0860 TP 1.0780',
    structured_payload: { strategy: 'LondonBreakout' }
  }, { requireIdentity: true });
  assert.equal(result.ok, true);
  assert.equal(result.event.source.type, 'tradingview');
  assert.equal(result.event.structured_payload.strategy, 'LondonBreakout');
});

test('fails closed when authenticated ingress lacks source identity or external event id', () => {
  const result = normalizeTradingEvent({ text: 'BUY EURUSD' }, { requireIdentity: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('source.instance_id is required'));
  assert.ok(result.errors.includes('external_event_id is required'));
});
