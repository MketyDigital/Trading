import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionBrokerTpProtectionRuntime } from '../src/execution/broker_tp_protection_production.js';

function queryResult(data) {
  const chain = {
    select() { return chain; }, eq() { return chain; },
    async maybeSingle() { return { data, error: null }; },
    upsert() { return chain; },
  };
  return chain;
}

test('broker TP production runtime records a stable event then invokes the existing orchestration and execution stages', async () => {
  const calls = { upserts: [], simulation: [], orchestrated: [], executed: [], observations: [] };
  const supabase = { from(table) {
    if (table === 'trading_events') {
      const q = queryResult(table === 'trading_events' && calls.upserts.length
        ? { id: 'persisted-tp-event' }
        : { id: 'source-event', source_connection_id: 'source-1', source_type: 'telegram', source_external_id: 'signal-1', external_event_id: 'signal-1', metadata: { provider_feed_id: 'feed-1' } });
      const originalUpsert = q.upsert;
      q.upsert = (body, options) => { calls.upserts.push({ body, options }); return originalUpsert.call(q); };
      return q;
    }
    if (table === 'source_connections') return queryResult({ id: 'source-1', source_instance_id: 'instance-1' });
    throw new Error(`unexpected table ${table}`);
  } };
  let sourceLookupCount = 0;
  const persistence = { supabase, async listBrokerTpProtectionCandidates() { return [{
    workspaceId: 'workspace-1', groupId: 'group-1', tradeAccountId: 'account-1', sourceEventId: 'signal-event-id',
    sourceInstanceId: 'instance-1', symbol: 'EURUSD', side: 'BUY', targetIndex: 1, legId: 'leg-1',
    brokerPositionId: '7001', lots: 0.1, takeProfit: 1.12, stopLoss: 1.1, groupCreatedAt: 1770000000000,
  }]; } };
  const runtime = createProductionBrokerTpProtectionRuntime({
    persistenceFactory: async () => persistence,
    executionDepsFactory: () => ({
      accountLoader: async () => ({ id: 'account-1', workspace_id: 'workspace-1', account_id: '123', platform: 'mt5',
        environment: 'demo', is_active: true, execution_enabled: true, safety_policy: { autoTpProtection: true } }),
      readBrokerPositionCloseStatus: async () => ({ accountId: '123', positionId: '7001', environment: 'demo', isLive: false,
        isOpen: false, initialLots: 0.1, closedLots: 0.1,
        deals: [{ dealId: 'deal-1', positionId: '7001', lots: 0.1, entry: 'OUT', reason: 'TP' }] }),
    }),
    simulationDepsFactory: async (input) => { calls.simulation.push(input); return { fake: true }; },
    orchestrateFn: async (input, deps) => { calls.orchestrated.push({ input, deps }); return { status: 'SIMULATED', accounts: [] }; },
    executionStageFn: async (input) => { calls.executed.push(input); return { status: 'SUCCEEDED' }; },
    clock: () => 1770000010000,
  });
  // The first source event lookup is the provenance read; the second result follows the upsert.
  const originalFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    const chain = originalFrom(table);
    if (table === 'trading_events') {
      const originalMaybeSingle = chain.maybeSingle;
      chain.maybeSingle = async () => {
        sourceLookupCount++;
        if (sourceLookupCount === 1) return { data: { id: 'signal-event-id', source_connection_id: 'source-1', source_type: 'telegram', source_external_id: 'signal-1', external_event_id: 'signal-1', metadata: { provider_feed_id: 'feed-1' } }, error: null };
        return { data: { id: 'persisted-tp-event' }, error: null };
      };
      chain.upsert = (body, options) => { calls.upserts.push({ body, options }); return chain; };
      return chain;
    }
    return chain;
  };

  const stateStub = { async fetch(url, options) {
    calls.observations.push({ url: String(url), body: JSON.parse(options.body) });
    return Response.json({ outcome: 'APPLIED' });
  } };
  const result = await runtime({
    TRADE_STATE_INTERNAL_TOKEN: 'state-token',
    TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => stateStub },
  });
  assert.equal(result.confirmed, 1);
  assert.equal(result.applied, 1);
  assert.equal(calls.upserts.length, 1);
  assert.equal(calls.upserts[0].body.processing_status, 'BROKER_TP_DETECTED');
  assert.equal(calls.upserts[0].body.canonical_intent.management.type, 'TARGET_HIT');
  assert.equal(calls.upserts[0].body.canonical_intent.management.targetIndex, 1);
  assert.equal(calls.simulation[0].sourceId, 'source-1');
  assert.equal(calls.orchestrated[0].input.interpretation.management.brokerPositionId, '7001');
  assert.equal(calls.executed[0].result.eventId, 'persisted-tp-event');
  assert.equal(calls.observations.length, 1);
  assert.match(calls.observations[0].url, /\/groups\/group-1\/legs\/leg-1\/broker-observation$/);
  assert.equal(calls.observations[0].body.status, 'TP_CONFIRMED');
  assert.deepEqual(calls.observations[0].body.dealIds, ['deal-1']);
});
