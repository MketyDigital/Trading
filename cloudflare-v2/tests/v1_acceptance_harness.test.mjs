import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignedV1Request,
  buildAcceptanceScenario,
  sanitizeAcceptanceResult,
  validateAcceptanceEnvironment,
} from '../src/testing/v1_acceptance_harness.js';
import { verifySignedSourcePayload } from '../src/security/source_auth.js';

test('builds a signed V1 request from one exact serialized body', async () => {
  const secret = 'source-secret-do-not-print';
  const built = await buildSignedV1Request({
    endpoint: 'https://trade.test/api/v1/events',
    sourceId: 'source-1',
    secret,
    timestamp: 1725180000000,
    event: {
      version: '1.0',
      source: { type: 'custom_webhook', instance_id: 'source-1' },
      external_event_id: 'acceptance-1',
      text: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
    },
  });

  assert.equal(built.request.method, 'POST');
  assert.equal(built.request.headers.get('X-Mkety-Source-Id'), 'source-1');
  assert.equal(await built.request.clone().text(), built.rawBody);
  const verified = await verifySignedSourcePayload({
    rawBody: built.rawBody,
    sourceId: built.request.headers.get('X-Mkety-Source-Id'),
    timestamp: built.request.headers.get('X-Mkety-Timestamp'),
    signature: built.request.headers.get('X-Mkety-Signature'),
    secret,
    nowMs: 1725180000000,
  });
  assert.equal(verified.ok, true);
});

test('scenario helper can deliberately reuse external id for duplicate/replay acceptance', () => {
  const original = buildAcceptanceScenario('complete_signal', { runId: 'run-42' });
  const duplicate = buildAcceptanceScenario('duplicate', { runId: 'run-42', duplicateOf: original });
  assert.equal(duplicate.event.external_event_id, original.event.external_event_id);
  assert.equal(duplicate.event.text, original.event.text);

  const second = buildAcceptanceScenario('complete_signal', { runId: 'run-43' });
  assert.notEqual(second.event.external_event_id, original.event.external_event_id);
});

test('environment validation reports secret names only and never values', () => {
  const result = validateAcceptanceEnvironment({
    TRADING_V1_ENDPOINT: 'https://trade.test/api/v1/events',
    TRADING_V1_SOURCE_ID: 'source-1',
    TRADING_V1_SOURCE_SECRET: 'super-secret-value',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-value/);

  const missing = validateAcceptanceEnvironment({ TRADING_V1_SOURCE_SECRET: 'another-secret' });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing.sort(), ['TRADING_V1_ENDPOINT', 'TRADING_V1_SOURCE_ID']);
  assert.doesNotMatch(JSON.stringify(missing), /another-secret/);
});

test('sanitized acceptance result never exposes signing headers, secret-looking fields or response credentials', () => {
  const sanitized = sanitizeAcceptanceResult({
    scenario: 'complete_signal',
    externalEventId: 'evt-1',
    requestHeaders: {
      'X-Mkety-Source-Id': 'source-1',
      'X-Mkety-Timestamp': '123',
      'X-Mkety-Signature': 'v1=deadbeef',
      Authorization: 'Bearer secret-token',
    },
    responseStatus: 200,
    responseBody: {
      status: 'READY',
      eventId: 'event-db-1',
      secret: 'must-not-print',
      token: 'must-not-print-either',
      simulation: { status: 'READY', executionEnabled: false, actions: [{ type: 'OPEN_POSITION' }] },
    },
  });

  const encoded = JSON.stringify(sanitized);
  assert.match(encoded, /evt-1/);
  assert.match(encoded, /event-db-1/);
  assert.match(encoded, /OPEN_POSITION/);
  assert.doesNotMatch(encoded, /deadbeef|secret-token|must-not-print/i);
  assert.equal(sanitized.request.sourceId, 'source-1');
  assert.equal(sanitized.request.timestamp, '123');
  assert.equal(sanitized.request.signature, '[REDACTED]');
});
