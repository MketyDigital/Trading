import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

let startProbeRuntime;
try {
  ({ startProbeRuntime } = await import('../../ops/coolify-staging-postgres-probe/probe_runtime.mjs'));
} catch {}

test('Coolify probe health becomes ready while the migration task is still running', async () => {
  assert.equal(typeof startProbeRuntime, 'function', 'probe runtime must expose a testable health-first entry point');
  let finishTask;
  const task = new Promise((resolve) => { finishTask = resolve; });
  const output = [];
  const runtime = await startProbeRuntime({
    host: '127.0.0.1',
    port: 0,
    runTask: () => task,
    successMarker: 'TRADING_SNAPSHOT_IMPORT_OK=',
    write: (line) => output.push(line)
  });

  try {
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}/health`);
    assert.equal(response.status, 200);
    assert.equal(runtime.state.status, 'running');
    assert.deepEqual(output, []);

    finishTask({ tables: 28 });
    await runtime.taskPromise;
    assert.equal(runtime.state.status, 'succeeded');
    assert.match(output[0], /^TRADING_SNAPSHOT_IMPORT_OK=/);
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
  }
});

test('Coolify probe records a sanitized task failure while staying healthy for log collection', async () => {
  assert.equal(typeof startProbeRuntime, 'function', 'probe runtime must expose a testable health-first entry point');
  const output = [];
  const runtime = await startProbeRuntime({
    host: '127.0.0.1',
    port: 0,
    runTask: async () => { throw new Error('source drift at table workspaces with password=secret-value'); },
    successMarker: 'TRADING_SNAPSHOT_IMPORT_OK=',
    write: (line) => output.push(line)
  });

  try {
    await runtime.taskPromise;
    assert.equal(runtime.state.status, 'failed');
    assert.match(output[0], /^TRADING_PROBE_FAILED=/);
    assert.doesNotMatch(output[0], /secret-value/);
    const response = await fetch(`http://127.0.0.1:${runtime.server.address().port}/health`);
    assert.equal(response.status, 200);
  } finally {
    runtime.server.close();
    await once(runtime.server, 'close');
  }
});
