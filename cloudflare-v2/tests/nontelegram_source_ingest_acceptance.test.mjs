import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';
import { buildSignedSourceEventPayload } from '../src/sources/nontelegram/source_event_adapter.js';

const NOW = 1_788_368_400_000;

function source({
  id,
  workspaceId,
  providerType,
  family,
  scope,
  secret,
}) {
  return {
    id,
    workspace_id: workspaceId,
    source_type: family,
    source_instance_id: id,
    source_family: family,
    provider_type: providerType,
    external_identity: scope,
    secret,
  };
}

function makeDependencies(sources) {
  const reservations = new Map();
  const reserveCalls = [];
  let nextId = 1;

  return {
    reserveCalls,
    dependencies: {
      sourceStore: {
        async getActiveSource(id) {
          return sources.get(id) ?? null;
        },
      },
      eventStore: {
        async reserve(row) {
          reserveCalls.push(structuredClone(row));
          const key = `${row.workspace_id}:${row.canonical_event_id ?? `${row.source_connection_id}:${row.external_event_id}`}`;
          if (reservations.has(key)) {
            return { ok: true, duplicate: true, eventId: reservations.get(key) };
          }
          const eventId = `evt-${nextId++}`;
          reservations.set(key, eventId);
          return { ok: true, duplicate: false, eventId };
        },
        async updateInterpretation() {},
      },
      aiRouter: { interpret: async () => null },
    },
  };
}

async function ingest(sourceRecord, payload, dependencies, secret = sourceRecord.secret) {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(NOW);
  const signature = await signSourcePayload(rawBody, timestamp, secret);
  return ingestTradingEvent({
    rawBody,
    sourceId: sourceRecord.id,
    timestamp,
    signature,
    nowMs: NOW,
  }, dependencies);
}

function payload(providerType, nativeEventId) {
  return buildSignedSourceEventPayload({
    providerType,
    nativeEventId,
    occurredAt: '2026-09-02T15:00:00.000Z',
    text: 'BUY XAUUSD 2500 SL 2490 TP 2520',
  });
}

test('MT5, cTrader and custom signed sources reserve independently through real V1 ingest', async () => {
  const mt5 = source({ id: 'mt5-a', workspaceId: 'ws-a', providerType: 'mt5_source_bridge', family: 'mt5', scope: 'terminal-1', secret: 'mt5-secret' });
  const ctrader = source({ id: 'ct-a', workspaceId: 'ws-a', providerType: 'ctrader_source', family: 'ctrader', scope: 'account-1', secret: 'ct-secret' });
  const custom = source({ id: 'custom-a', workspaceId: 'ws-a', providerType: 'custom_signed_api', family: 'custom_api', scope: 'client-1', secret: 'custom-secret' });
  const sources = new Map([[mt5.id, mt5], [ctrader.id, ctrader], [custom.id, custom]]);
  const { dependencies, reserveCalls } = makeDependencies(sources);

  const results = await Promise.all([
    ingest(mt5, payload(mt5.provider_type, 'event-42'), dependencies),
    ingest(ctrader, payload(ctrader.provider_type, 'event-42'), dependencies),
    ingest(custom, payload(custom.provider_type, 'event-42'), dependencies),
  ]);

  assert.deepEqual(results.map((result) => [result.ok, result.duplicate]), [
    [true, false],
    [true, false],
    [true, false],
  ]);
  assert.deepEqual(reserveCalls.map((row) => row.canonical_event_id).sort(), [
    'ctrader:account-1:event-42',
    'custom_api:client-1:event-42',
    'mt5:terminal-1:event-42',
  ]);
});

test('duplicate in one source family is terminal locally and does not suppress sibling families', async () => {
  const mt5 = source({ id: 'mt5-a', workspaceId: 'ws-a', providerType: 'mt5_source_bridge', family: 'mt5', scope: 'terminal-1', secret: 'mt5-secret' });
  const ctrader = source({ id: 'ct-a', workspaceId: 'ws-a', providerType: 'ctrader_source', family: 'ctrader', scope: 'account-1', secret: 'ct-secret' });
  const sources = new Map([[mt5.id, mt5], [ctrader.id, ctrader]]);
  const { dependencies } = makeDependencies(sources);

  const first = await ingest(mt5, payload(mt5.provider_type, 'event-1'), dependencies);
  const duplicate = await ingest(mt5, payload(mt5.provider_type, 'event-1'), dependencies);
  const sibling = await ingest(ctrader, payload(ctrader.provider_type, 'event-1'), dependencies);

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(sibling.ok, true);
  assert.equal(sibling.duplicate, false);
});

test('bad credential for one source cannot reserve or poison another source', async () => {
  const mt5 = source({ id: 'mt5-a', workspaceId: 'ws-a', providerType: 'mt5_source_bridge', family: 'mt5', scope: 'terminal-1', secret: 'mt5-secret' });
  const custom = source({ id: 'custom-a', workspaceId: 'ws-a', providerType: 'custom_signed_api', family: 'custom_api', scope: 'client-1', secret: 'custom-secret' });
  const sources = new Map([[mt5.id, mt5], [custom.id, custom]]);
  const { dependencies, reserveCalls } = makeDependencies(sources);

  const rejected = await ingest(mt5, payload(mt5.provider_type, 'event-7'), dependencies, 'wrong-secret');
  const sibling = await ingest(custom, payload(custom.provider_type, 'event-7'), dependencies);

  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
  assert.equal(sibling.ok, true);
  assert.equal(sibling.duplicate, false);
  assert.equal(reserveCalls.length, 1);
  assert.equal(reserveCalls[0].source_connection_id, custom.id);
});

test('authenticated source workspace remains authoritative over caller payload hints', async () => {
  const custom = source({ id: 'custom-a', workspaceId: 'ws-a', providerType: 'custom_signed_api', family: 'custom_api', scope: 'client-1', secret: 'custom-secret' });
  const sources = new Map([[custom.id, custom]]);
  const { dependencies, reserveCalls } = makeDependencies(sources);
  const eventPayload = payload(custom.provider_type, 'event-99');
  eventPayload.workspace_hint = 'ws-b';
  eventPayload.workspace_id = 'ws-b';

  const result = await ingest(custom, eventPayload, dependencies);

  assert.equal(result.ok, true);
  assert.equal(reserveCalls.length, 1);
  assert.equal(reserveCalls[0].workspace_id, 'ws-a');
  assert.equal(reserveCalls[0].canonical_event_id, 'custom_api:client-1:event-99');
});

test('same scoped native event remains isolated between workspaces', async () => {
  const a = source({ id: 'custom-a', workspaceId: 'ws-a', providerType: 'custom_signed_api', family: 'custom_api', scope: 'shared-client', secret: 'secret-a' });
  const b = source({ id: 'custom-b', workspaceId: 'ws-b', providerType: 'custom_signed_api', family: 'custom_api', scope: 'shared-client', secret: 'secret-b' });
  const sources = new Map([[a.id, a], [b.id, b]]);
  const { dependencies } = makeDependencies(sources);
  const eventPayload = payload('custom_signed_api', 'event-5');

  const resultA = await ingest(a, eventPayload, dependencies);
  const resultB = await ingest(b, eventPayload, dependencies);

  assert.equal(resultA.ok, true);
  assert.equal(resultA.duplicate, false);
  assert.equal(resultB.ok, true);
  assert.equal(resultB.duplicate, false);
});
