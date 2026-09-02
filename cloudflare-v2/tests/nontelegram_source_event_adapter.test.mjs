import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSignedSourceEventPayload,
} from '../src/sources/nontelegram/source_event_adapter.js';

function base(overrides = {}) {
  return {
    providerType: 'mt5_source_bridge',
    nativeEventId: 'tx-1001',
    occurredAt: '2026-09-02T15:00:00.000Z',
    text: 'BUY XAUUSD 2500 SL 2490 TP 2520',
    ...overrides,
  };
}

test('MT5 source adapter emits canonical V1 native identity without workspace or execution authority', () => {
  const payload = buildSignedSourceEventPayload(base());

  assert.equal(payload.external_event_id, 'tx-1001');
  assert.equal(payload.occurred_at, '2026-09-02T15:00:00.000Z');
  assert.equal(payload.text, 'BUY XAUUSD 2500 SL 2490 TP 2520');
  assert.deepEqual(payload.metadata.native_identity, { transaction_id: 'tx-1001' });
  assert.equal('workspace_hint' in payload, false);
  assert.equal('workspace_id' in payload, false);
  assert.equal('source_connection_id' in payload, false);
  assert.equal('broker_account_id' in payload, false);
  assert.equal('execution_enabled' in payload, false);
});

test('cTrader and custom API source adapters preserve stable provider-native event ids', () => {
  const ctrader = buildSignedSourceEventPayload(base({
    providerType: 'ctrader_source',
    nativeEventId: 'ct-event-9',
  }));
  const custom = buildSignedSourceEventPayload(base({
    providerType: 'custom_signed_api',
    nativeEventId: 'custom-event-22',
    structuredPayload: { symbol: 'XAUUSD', side: 'buy' },
  }));

  assert.deepEqual(ctrader.metadata.native_identity, { event_id: 'ct-event-9' });
  assert.equal(ctrader.external_event_id, 'ct-event-9');
  assert.deepEqual(custom.metadata.native_identity, { event_id: 'custom-event-22' });
  assert.deepEqual(custom.structured_payload, { symbol: 'XAUUSD', side: 'buy' });
});

test('adapter fails closed for unsupported provider, missing native id, or empty content', () => {
  assert.throws(
    () => buildSignedSourceEventPayload(base({ providerType: 'tradingview_webhook' })),
    /SOURCE_ADAPTER_PROVIDER_UNSUPPORTED/,
  );
  assert.throws(
    () => buildSignedSourceEventPayload(base({ nativeEventId: '  ' })),
    /SOURCE_NATIVE_EVENT_ID_REQUIRED/,
  );
  assert.throws(
    () => buildSignedSourceEventPayload(base({ text: '', structuredPayload: null })),
    /SOURCE_EVENT_CONTENT_REQUIRED/,
  );
});

test('adapter never copies caller workspace, credentials, destination or execution fields', () => {
  const payload = buildSignedSourceEventPayload(base({
    workspaceId: 'foreign-workspace',
    workspace_hint: 'foreign-workspace',
    sourceSecret: 'must-not-leak',
    providerSecret: 'must-not-leak',
    brokerAccountId: 'broker-1',
    destinationId: 'dest-1',
    executionEnabled: true,
    metadata: {
      bridge_version: '1.2.3',
      workspace_id: 'foreign-workspace',
      source_secret: 'must-not-leak',
      destination_id: 'dest-1',
    },
  }));

  assert.deepEqual(payload.metadata, {
    bridge_version: '1.2.3',
    native_identity: { transaction_id: 'tx-1001' },
  });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes('foreign-workspace'), false);
  assert.equal(serialized.includes('broker-1'), false);
  assert.equal(serialized.includes('dest-1'), false);
});

test('same native event serializes deterministically across retries', () => {
  const one = buildSignedSourceEventPayload(base({
    metadata: { bridge_version: '1.2.3', sequence: 4 },
  }));
  const two = buildSignedSourceEventPayload(base({
    metadata: { sequence: 4, bridge_version: '1.2.3' },
  }));

  assert.deepEqual(one, two);
});
