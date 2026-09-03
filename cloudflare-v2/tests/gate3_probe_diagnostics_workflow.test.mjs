import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url);

test('Gate 3 certificate probe reports sanitized arrival diagnostics before failing closed', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const start = workflow.indexOf('cloudflare-probe-gate3-tradingview:');
  assert.ok(start >= 0, 'Gate 3 probe job must exist');
  const block = workflow.slice(start);

  assert.match(block, /probeLogCount/);
  assert.match(block, /certPresentedCount/);
  assert.match(block, /fingerprintCount/);
  assert.match(block, /Gate 3 probe diagnostics: totalProbeLogs=/);
  assert.match(block, /expectedSpoofLogs=1/);
  assert.match(block, /additionalProbeLogs=/);
  assert.doesNotMatch(block, /console\.log\([^\n]*(body|workspace|source_id|token|password|api_key|private_key)/i);
});
