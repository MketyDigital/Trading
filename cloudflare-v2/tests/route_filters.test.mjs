import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRouteFilters } from '../src/destinations/route_filters.js';

const broker = { destination_type: 'broker_account' };
const telegram = { destination_type: 'telegram' };
const xau = { intent: { symbol: { canonical: 'XAUUSD' } } };
const v75 = { intent: { symbol: { canonical: 'DERIV:VOLATILITY_75' } } };

test('empty route filters preserve existing behavior', () => {
  assert.deepEqual(evaluateRouteFilters({}, xau, broker), { allowed: true, reason: null });
});

test('allowed canonical symbols permit matching broker intent and reject another symbol', () => {
  assert.equal(evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'] }, xau, broker).allowed, true);
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'] }, v75, broker),
    { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_NOT_ALLOWED' },
  );
});

test('blocked canonical symbols win over allow list', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'], blockedCanonicalSymbols: ['XAUUSD'] }, xau, broker),
    { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_BLOCKED' },
  );
});

test('malformed broker filters fail closed', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: 'XAUUSD' }, xau, broker),
    { allowed: false, reason: 'ROUTE_FILTERS_INVALID' },
  );
});

test('symbol-filtered broker route fails closed when canonical symbol is unavailable', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: ['XAUUSD'] }, { intent: {} }, broker),
    { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_UNAVAILABLE' },
  );
});

test('malformed/noncanonical filters never block non-broker Telegram forwarding', () => {
  assert.deepEqual(
    evaluateRouteFilters({ allowedCanonicalSymbols: 'bad-shape' }, {}, telegram),
    { allowed: true, reason: null },
  );
});

const updatesOnlyTelegram = {
  destination_type: 'telegram',
  template: {
    layout: {
      deliveryPolicy: {
        mode: 'updates_only',
        allowedEvents: ['TP_HIT', 'SL_HIT', 'WEEKLY_ROUNDUP'],
      },
    },
  },
};

test('updates-only Telegram template permits confirmed TP-hit broker events', () => {
  assert.deepEqual(
    evaluateRouteFilters(
      {},
      { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 1 } },
      updatesOnlyTelegram,
      { metadata: { broker_fill: { kind: 'TAKE_PROFIT' } }, text: 'Broker take-profit fill detected' },
    ),
    { allowed: true, reason: null },
  );
});

test('updates-only Telegram template permits broker-confirmed SL-hit events', () => {
  assert.deepEqual(
    evaluateRouteFilters(
      {},
      { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
      updatesOnlyTelegram,
      { metadata: { broker_activity: { kind: 'STOP_LOSS' } }, text: 'Broker stop_loss detected' },
    ),
    { allowed: true, reason: null },
  );
});

test('updates-only Telegram template permits a clearly headed weekly roundup without trade intent', () => {
  assert.deepEqual(
    evaluateRouteFilters(
      {},
      { status: 'COMMENTARY' },
      updatesOnlyTelegram,
      { text: '📊 WEEKLY ROUNDUP\nA summary of the week.' },
    ),
    { allowed: true, reason: null },
  );
});

test('updates-only Telegram template blocks trade signals even when the text says weekly roundup', () => {
  assert.deepEqual(
    evaluateRouteFilters(
      {},
      { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } },
      updatesOnlyTelegram,
      { text: 'WEEKLY ROUNDUP\nBUY XAUUSD now' },
    ),
    { allowed: false, reason: 'ROUTE_UPDATE_EVENT_NOT_ALLOWED' },
  );
});

test('updates-only Telegram template blocks ordinary commentary and unknown event types', () => {
  assert.deepEqual(
    evaluateRouteFilters({}, { status: 'COMMENTARY' }, updatesOnlyTelegram, { text: 'Market is quiet today.' }),
    { allowed: false, reason: 'ROUTE_UPDATE_EVENT_NOT_ALLOWED' },
  );
});

test('updates-only template fails closed on non-Telegram destinations and invalid allowlists', () => {
  assert.deepEqual(
    evaluateRouteFilters({}, { status: 'COMMENTARY' }, { ...updatesOnlyTelegram, destination_type: 'broker_account' }, { text: 'WEEKLY ROUNDUP' }),
    { allowed: false, reason: 'ROUTE_UPDATE_TEMPLATE_TELEGRAM_ONLY' },
  );
  assert.deepEqual(
    evaluateRouteFilters({}, { status: 'COMMENTARY' }, {
      destination_type: 'telegram',
      template: { layout: { deliveryPolicy: { mode: 'updates_only', allowedEvents: ['NEW_SIGNAL'] } } },
    }, { text: 'WEEKLY ROUNDUP' }),
    { allowed: false, reason: 'ROUTE_UPDATE_TEMPLATE_INVALID' },
  );
});
