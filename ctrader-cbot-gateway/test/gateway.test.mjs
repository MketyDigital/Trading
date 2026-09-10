import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { WebSocket } from 'ws';
import { createConnectionToken } from '../src/protocol.js';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHttp(url, secret, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
      if ([200, 404].includes(response.status)) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('gateway did not become ready');
}

function command(id, accountRowId) {
  const now = Date.now();
  return {
    version: 'mkety.ctrader.cbot.v1',
    command_id: id,
    account_id: accountRowId,
    issued_at: now,
    expires_at: now + 30_000,
    command: { action: 'OPEN_POSITION', symbol: 'EURUSD', side: 'BUY', lots: 0.01 },
  };
}

async function readMessage(socket) {
  const [data] = await once(socket, 'message');
  return JSON.parse(data.toString());
}

test('gateway authenticates a cBot, correlates a result, rejects replay, and fails closed offline', async (t) => {
  const wsPort = await freePort();
  const controlPort = await freePort();
  const signingKey = 'test-signing-key';
  const controlSecret = 'test-control-secret';
  const accountRowId = 'row-e2e-1';
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      CBOT_WS_PORT: String(wsPort),
      CBOT_CONTROL_PORT: String(controlPort),
      CBOT_TOKEN_SIGNING_KEY: signingKey,
      CBOT_CONTROL_SECRET: controlSecret,
      CBOT_COMMAND_TIMEOUT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));

  const controlBase = `http://127.0.0.1:${controlPort}`;
  await waitForHttp(`${controlBase}/v1/connections/${accountRowId}`, controlSecret);

  const token = createConnectionToken({ accountRowId, expiresAt: Date.now() + 60_000 }, signingKey);
  const socket = new WebSocket(`ws://127.0.0.1:${wsPort}/v1/cbot`);
  t.after(() => socket.close());
  await once(socket, 'open');
  socket.send(JSON.stringify({
    type: 'auth',
    connectionToken: token,
    accountNumber: '12345678',
    brokerName: 'Test Broker',
    isLive: false,
    instanceId: 'instance-1',
  }));
  const auth = await readMessage(socket);
  assert.equal(auth.type, 'auth_ok');
  assert.equal(auth.accountRowId, accountRowId);

  const firstCommand = command('cmd-e2e-1', accountRowId);
  const firstRequest = fetch(`${controlBase}/v1/commands/${accountRowId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(firstCommand),
  });
  const delivered = await readMessage(socket);
  assert.equal(delivered.type, 'command');
  assert.equal(delivered.envelope.command_id, firstCommand.command_id);
  socket.send(JSON.stringify({ type: 'result', commandId: firstCommand.command_id, ok: true, positionId: 77 }));
  const firstResponse = await firstRequest;
  assert.equal(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), { type: 'result', commandId: firstCommand.command_id, ok: true, positionId: 77 });

  const replayRequest = fetch(`${controlBase}/v1/commands/${accountRowId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(firstCommand),
  });
  const replayDelivered = await readMessage(socket);
  if (replayDelivered?.type === 'command') {
    socket.send(JSON.stringify({ type: 'result', commandId: firstCommand.command_id, ok: true, positionId: 78 }));
  }
  const replayResponse = await replayRequest;
  assert.equal(replayResponse.status, 409);
  assert.equal((await replayResponse.json()).reason, 'COMMAND_ALREADY_DELIVERED');

  socket.close();
  await once(socket, 'close');
  const offlineResponse = await fetch(`${controlBase}/v1/commands/${accountRowId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command('cmd-offline', accountRowId)),
  });
  assert.equal(offlineResponse.status, 409);
  assert.equal((await offlineResponse.json()).reason, 'CBOT_OFFLINE');
});
