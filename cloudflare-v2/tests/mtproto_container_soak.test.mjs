import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  validateSoakEnvironment,
  createSoakMetrics,
  recordHealthSample,
  recordEventSample,
  buildSoakSummary,
} from '../scripts/mtproto_container_soak.mjs';

const completeEnv = {
  MTPROTO_SOAK_ENABLED: 'true',
  MTPROTO_SOAK_HEALTH_URL: 'https://health.example.test/source',
  MTPROTO_SOAK_EVENTS_URL: 'https://events.example.test/source',
  MTPROTO_SOAK_BEARER_TOKEN: 'secret-token',
  MTPROTO_SOAK_WORKSPACE_ID: 'ws-1',
  MTPROTO_SOAK_SOURCE_ID: 'src-container',
};

test('soak environment is explicit opt-in and reports missing names only', () => {
  const disabled = validateSoakEnvironment({});
  assert.deepEqual(disabled, { ok: false, reason: 'SOAK_NOT_ENABLED', missing: ['MTPROTO_SOAK_ENABLED'] });

  const partial = validateSoakEnvironment({ MTPROTO_SOAK_ENABLED: 'true', MTPROTO_SOAK_BEARER_TOKEN: 'never-echo-me' });
  assert.equal(partial.ok, false);
  assert.equal(partial.reason, 'SOAK_CONFIG_MISSING');
  assert.deepEqual(partial.missing.sort(), [
    'MTPROTO_SOAK_EVENTS_URL',
    'MTPROTO_SOAK_HEALTH_URL',
    'MTPROTO_SOAK_SOURCE_ID',
    'MTPROTO_SOAK_WORKSPACE_ID',
  ].sort());
  assert.equal(JSON.stringify(partial).includes('never-echo-me'), false);

  assert.deepEqual(validateSoakEnvironment(completeEnv), { ok: true, missing: [] });
});

test('metrics record disconnect/reconnect health transitions without global coupling', () => {
  const metrics = createSoakMetrics({ workspaceId: 'ws-1', sourceId: 'src-container', startedAtMs: 1000 });
  recordHealthSample(metrics, { status: 'HEALTHY', connected: true }, 1100);
  recordHealthSample(metrics, { status: 'DEGRADED', connected: false }, 1200);
  recordHealthSample(metrics, { status: 'HEALTHY', connected: true }, 1400);

  assert.equal(metrics.disconnectCount, 1);
  assert.equal(metrics.reconnectCount, 1);
  assert.deepEqual(metrics.healthTransitions.map((item) => item.status), ['HEALTHY', 'DEGRADED', 'HEALTHY']);
  assert.equal(metrics.lastConnected, true);
});

test('event samples record latency catch-up and duplicate observations by canonical identity', () => {
  const metrics = createSoakMetrics({ workspaceId: 'ws-1', sourceId: 'src-container', startedAtMs: 1000 });
  recordEventSample(metrics, {
    canonicalEventId: 'telegram:acct:-1001:1',
    occurredAt: '1970-01-01T00:00:01.000Z',
    receivedAt: '1970-01-01T00:00:01.250Z',
    catchUp: false,
  });
  recordEventSample(metrics, {
    canonicalEventId: 'telegram:acct:-1001:1',
    occurredAt: '1970-01-01T00:00:01.000Z',
    receivedAt: '1970-01-01T00:00:01.300Z',
    catchUp: true,
  });

  assert.equal(metrics.eventCount, 2);
  assert.equal(metrics.uniqueEventCount, 1);
  assert.equal(metrics.duplicateCount, 1);
  assert.equal(metrics.catchUpCount, 1);
  assert.deepEqual(metrics.latencyMs, [250, 300]);
});

test('summary is secret-free and contains no broker execution state', () => {
  const metrics = createSoakMetrics({ workspaceId: 'ws-1', sourceId: 'src-container', startedAtMs: 1000 });
  metrics.eventCount = 2;
  metrics.uniqueEventCount = 1;
  metrics.duplicateCount = 1;
  metrics.catchUpCount = 1;
  metrics.latencyMs.push(100, 300);
  metrics.healthTransitions.push({ atMs: 1100, status: 'HEALTHY', connected: true });

  const summary = buildSoakSummary(metrics, { endedAtMs: 2000 });
  assert.deepEqual(summary.latencyMs, { min: 100, max: 300, avg: 200 });
  assert.equal(summary.durationMs, 1000);
  assert.equal(JSON.stringify(summary).includes('token'), false);
  assert.equal(JSON.stringify(summary).includes('session'), false);
  assert.equal('broker' in summary, false);
  assert.equal('actions' in summary, false);
});

test('package exposes opt-in soak command and script contains no live/broker execution command', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['soak:mtproto:container'], 'node scripts/mtproto_container_soak.mjs');

  const source = await fs.readFile(new URL('../scripts/mtproto_container_soak.mjs', import.meta.url), 'utf8');
  assert.match(source, /MTPROTO_SOAK_ENABLED/);
  assert.match(source, /MTPROTO_SOAK_HEALTH_URL/);
  assert.match(source, /MTPROTO_SOAK_EVENTS_URL/);
  assert.doesNotMatch(source, /executeTrade|placeOrder|marketOrder|liveOrder|ALLOW_LIVE_TRADING/i);
});
