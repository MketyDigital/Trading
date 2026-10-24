import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeManualFastLegRecovery } from '../src/execution/manual_fast_leg_recovery.js';

const t = Date.parse('2026-10-24T17:45:00Z');
const group = { id: 'g', tradeAccountId: 'a', side: 'BUY', createdAt: new Date(t).toISOString(),
  legs: [{ targetIndex: 1, brokerPositionId: 'fast' }] };
const p = (ticket, tp, overrides = {}) => ({
  ticket, accountId: 'a', platformSymbol: 'Volatility 75 Index', side: 'BUY',
  openedAt: new Date(t + 90_000).toISOString(), lots: 0.01, takeProfit: tp, ...overrides,
});
const run = (positions, overrides = {}) => proposeManualFastLegRecovery({
  group, positions, resolvedPlatformSymbol: 'Volatility 75 Index',
  targetPrices: [101, 102, 103], tickSize: 0.01, nowMs: t + 120_000, ...overrides,
});

test('proposes exact unique manual legs without authorizing broker execution', () => {
  const result = run([p('two', 102), p('three', 103)]);
  assert.equal(result.status, 'PROPOSED');
  assert.deepEqual(result.proposals.map(x => [x.targetIndex, x.brokerPositionId]), [[2,'two'],[3,'three']]);
});
test('does not attach opposite direction, unrelated account, symbol, or old trade', () => {
  const result = run([p('bad', 102, { side:'SELL' }), p('bad2', 102, { accountId:'b' }),
    p('bad3', 102, { platformSymbol:'Volatility 50 Index' }), p('bad4', 102, { openedAt:new Date(t-60_000).toISOString() })]);
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.proposals.length, 0);
});
test('duplicate candidates and reused known tickets fail closed', () => {
  const result = run([p('two',102), p('another',102), p('fast',103)]);
  assert.equal(result.status, 'NEEDS_REVIEW'); assert.equal(result.proposals.length,0);
});
test('stale fast groups and absent authoritative tick or symbol are ineligible', () => {
  assert.equal(run([], { nowMs:t + 60*60_000 }).status,'INELIGIBLE');
  assert.equal(run([], { tickSize:null }).status,'INELIGIBLE');
  assert.equal(run([], { resolvedPlatformSymbol:null }).status,'INELIGIBLE');
});
test('same target price on multiple legs never auto-binds', () => {
  const result = run([p('two',102)], {targetPrices:[101,102,102]});
  assert.equal(result.proposals.length,0);
  assert.equal(result.status,'NEEDS_REVIEW');
});

test('protected completed starter may propose missing manual TP2 and TP3 safely', () => {
  const completeButShort = { ...group, incomplete: false, legs: [
    {targetIndex:1, brokerPositionId:'fast', takeProfit:101, stopLoss:99}
  ]};
  const result = run([p('two',102),p('three',103)], {group:completeButShort});
  assert.equal(result.status,'PROPOSED');
  assert.deepEqual(result.proposals.map(x=>x.targetIndex),[2,3]);
});

test('already managed TP2 is never proposed again for a completed trade', () => {
  const completeWithTwo = { ...group, incomplete:false, legs:[
    {targetIndex:1,brokerPositionId:'fast',takeProfit:101},
    {targetIndex:2,brokerPositionId:'two',takeProfit:102}
  ]};
  const result = run([p('two',102),p('three',103)], {group:completeWithTwo});
  assert.equal(result.status,'PROPOSED');
  assert.deepEqual(result.proposals.map(x=>[x.targetIndex,x.brokerPositionId]),[[3,'three']]);
});
