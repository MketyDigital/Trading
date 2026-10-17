export class ReplicationGapError extends Error {
  constructor(expected, received) {
    super(`Replication sequence gap: expected ${expected}, received ${received}`);
    this.name = 'ReplicationGapError';
    this.expected = expected;
    this.received = received;
  }
}

/** Replay one bounded, ordered page. applyEvent must be idempotent. */
export async function replayReplicationPage({
  journal,
  direction,
  authorityEpoch,
  checkpoint,
  limit = 100,
  applyEvent,
  saveCheckpoint,
}) {
  if (!journal || typeof journal.readAfter !== 'function') throw new Error('Replication journal is required');
  if (typeof applyEvent !== 'function' || typeof saveCheckpoint !== 'function') throw new Error('Replication apply and checkpoint functions are required');
  const pageSize = Math.max(1, Math.min(499, Math.trunc(Number(limit) || 100)));
  const fetched = await journal.readAfter({ direction, authorityEpoch, sequence: checkpoint, limit: pageSize + 1 });
  const rows = fetched.slice(0, pageSize);
  let lastSequence = Number(checkpoint) || 0;
  let applied = 0;
  for (const row of rows) {
    const sequence = Number(row.sequence);
    if (sequence !== lastSequence + 1) throw new ReplicationGapError(lastSequence + 1, sequence);
    await applyEvent(row);
    lastSequence = sequence;
    applied += 1;
  }
  // Persist one checkpoint per page to bound D1 writes. If checkpointing fails,
  // the whole page replays; target application therefore must be idempotent.
  if (applied) await saveCheckpoint({ direction, authorityEpoch, sequence: lastSequence });
  return { applied, checkpoint: lastSequence, hasMore: fetched.length > pageSize };
}
