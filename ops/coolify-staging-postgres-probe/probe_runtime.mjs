import { createServer } from 'node:http';

function safeError(error) {
  return String(error?.message || error || 'Probe task failed')
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgresql://***')
    .replace(/Bearer\s+[^\s"'`]+/gi, 'Bearer ***')
    .replace(/((?:password|secret|token|authorization)\s*[=:]\s*)[^\s"'`]+/gi, '$1***')
    .slice(0, 500);
}

export async function startProbeRuntime({
  host = '0.0.0.0',
  port = 3000,
  runTask,
  successMarker,
  write = console.log
} = {}) {
  if (typeof runTask !== 'function') throw new Error('Coolify probe task is required');
  if (typeof successMarker !== 'string' || !/^TRADING_[A-Z_]+_OK=$/.test(successMarker)) {
    throw new Error('Coolify probe success marker is invalid');
  }

  const state = { status: 'starting' };
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      .end(JSON.stringify({ ok: true }));
  });
  server.listen(port, host);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  state.status = 'running';
  const taskPromise = Promise.resolve().then(runTask).then((result) => {
    state.status = 'succeeded';
    write(`${successMarker}${JSON.stringify(result)}`);
  }).catch((error) => {
    state.status = 'failed';
    write(`TRADING_PROBE_FAILED=${JSON.stringify({ message: safeError(error) })}`);
  });

  return { server, state, taskPromise };
}
