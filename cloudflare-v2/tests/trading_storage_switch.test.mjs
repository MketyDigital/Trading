import test from 'node:test';
import assert from 'node:assert/strict';
import { planTradingStorageSwitch, executeTradingStorageSwitch } from '../src/persistence/trading_storage_switch.js';

const ready = {
  ingressPaused: true,
  consumersPaused: true,
  inFlightDrained: true,
  uncertainBrokerOperationsReconciled: true,
  replicationCaughtUp: true,
  parityVerified: true,
  liveExecutionDisabled: true,
};

test('switch plan requires all quiescence, parity, and safety gates', () => {
  assert.deepEqual(planTradingStorageSwitch({ current: 'd1', target: 'postgres', authorityEpoch: 8, evidence: ready }), {
    current: 'd1', target: 'postgres', expectedEpoch: 8, nextEpoch: 9, steps: ['fence_current', 'activate_target', 'verify_target', 'resume_consumers'],
  });
  assert.throws(() => planTradingStorageSwitch({ current: 'd1', target: 'postgres', authorityEpoch: 8, evidence: { ...ready, parityVerified: false } }), /parityVerified/);
});

test('switch fences first and fails closed if target activation or verification fails', async () => {
  const calls = [];
  await assert.rejects(() => executeTradingStorageSwitch({
    current: 'd1', target: 'postgres', authorityEpoch: 8, evidence: ready,
    fenceCurrent: async x => calls.push(`fence:${x.nextEpoch}`),
    activateTarget: async () => calls.push('activate'),
    verifyTarget: async () => { throw new Error('target unhealthy'); },
    resumeConsumers: async () => calls.push('resume'),
  }), /target unhealthy/);
  assert.deepEqual(calls, ['fence:9', 'activate']);
});

test('switch never resumes consumers before target health is verified', async () => {
  const calls = [];
  const result = await executeTradingStorageSwitch({
    current: 'd1', target: 'postgres', authorityEpoch: 8, evidence: ready,
    fenceCurrent: async () => calls.push('fence'),
    activateTarget: async () => calls.push('activate'),
    verifyTarget: async () => calls.push('verify'),
    resumeConsumers: async () => calls.push('resume'),
  });
  assert.deepEqual(calls, ['fence', 'activate', 'verify', 'resume']);
  assert.equal(result.authorityEpoch, 9);
});
