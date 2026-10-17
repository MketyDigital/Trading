import test from 'node:test';
import assert from 'node:assert/strict';
import { replayReplicationPage, ReplicationGapError } from '../src/persistence/replication_runner.js';

function journal(rows) {
  return { async readAfter({ sequence, limit }) { return rows.filter(row => row.sequence > sequence).slice(0, limit); } };
}

test('replication applies rows in order and checkpoints once after the whole page succeeds', async () => {
  const order = [];
  const result = await replayReplicationPage({
    journal: journal([{ sequence: 1 }, { sequence: 2 }]), direction: 'd1_to_postgres', authorityEpoch: 1, checkpoint: 0,
    applyEvent: async row => order.push(`apply:${row.sequence}`),
    saveCheckpoint: async ({ sequence }) => order.push(`checkpoint:${sequence}`),
  });
  assert.deepEqual(order, ['apply:1', 'apply:2', 'checkpoint:2']);
  assert.equal(result.checkpoint, 2);
  assert.equal(result.applied, 2);
});

test('replication stops at a sequence gap without applying later rows', async () => {
  const applied = [];
  await assert.rejects(() => replayReplicationPage({
    journal: journal([{ sequence: 2 }]), direction: 'd1_to_postgres', authorityEpoch: 1, checkpoint: 0,
    applyEvent: async row => applied.push(row.sequence), saveCheckpoint: async () => {},
  }), ReplicationGapError);
  assert.deepEqual(applied, []);
});

test('replication does not advance the checkpoint if an apply fails', async () => {
  const checkpoints = [];
  await assert.rejects(() => replayReplicationPage({
    journal: journal([{ sequence: 1 }]), direction: 'd1_to_postgres', authorityEpoch: 1, checkpoint: 0,
    applyEvent: async () => { throw new Error('standby unavailable'); }, saveCheckpoint: async value => checkpoints.push(value),
  }), /standby unavailable/);
  assert.deepEqual(checkpoints, []);
});

test('replication uses one lookahead row to report backlog without an extra empty poll', async () => {
  const applied = [];
  const result = await replayReplicationPage({
    journal: journal([{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }]), direction: 'd1_to_postgres', authorityEpoch: 1, checkpoint: 0, limit: 2,
    applyEvent: async row => applied.push(row.sequence), saveCheckpoint: async () => {},
  });
  assert.deepEqual(applied, [1, 2]);
  assert.equal(result.hasMore, true);
  assert.equal(result.checkpoint, 2);
});
