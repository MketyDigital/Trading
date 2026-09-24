import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { WebSocket } from 'ws';
import { createMt5TokenForTest } from '../src/mt5_protocol.js';

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
  throw new Error('MT5 gateway did not become ready');
}

async function readMessage(socket) {
  const [data] = await once(socket, 'message');
  return JSON.parse(data.toString());
}

test('MT5 gateway accepts reusable pairing auth until expiry, issues instance reconnect auth, and serves fresh context', async (t) => {
  const wsPort = await freePort();
  const controlPort = await freePort();
  const signingKey = 'test-signing-key';
  const controlSecret = 'test-control-secret';
  const accountRowId = 'row-mt5-context';
  const child = spawn(process.execPath, ['src/mt5_server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      MT5_CONNECTOR_WS_PORT: String(wsPort),
      MT5_CONNECTOR_CONTROL_PORT: String(controlPort),
      CBOT_TOKEN_SIGNING_KEY: signingKey,
      CBOT_CONTROL_SECRET: controlSecret,
      MT5_CONNECTOR_COMMAND_TIMEOUT_MS: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));

  const controlBase = `http://127.0.0.1:${controlPort}`;
  await waitForHttp(`${controlBase}/v1/mt5-connections/${accountRowId}`, controlSecret);
  const token = createMt5TokenForTest({ accountRowId, expiresAt: Date.now() + 60_000 }, signingKey);
  const socket = new WebSocket(`ws://127.0.0.1:${wsPort}/v1/mt5`);
  t.after(() => socket.close());
  await once(socket, 'open');
  socket.send(JSON.stringify({
    type: 'auth', connectionToken: token, accountNumber: '50123456', serverName: 'Broker-Demo',
    brokerName: 'Broker Ltd', isLive: false, connectorInstanceId: 'mt5-instance-1', symbols: [{ platformSymbol: 'XAUUSD.r' }],
  }));
  const auth = await readMessage(socket);
  assert.equal(auth.type, 'auth_ok');
  assert.equal(auth.accountRowId, accountRowId);
  assert.match(auth.reconnectToken, /^mt5r1\./);

  const reusedPair = new WebSocket(`ws://127.0.0.1:${wsPort}/v1/mt5`);
  t.after(() => reusedPair.close());
  await once(reusedPair, 'open');
  reusedPair.send(JSON.stringify({
    type: 'auth', connectionToken: token, accountNumber: '50123456', serverName: 'Broker-Demo',
    brokerName: 'Broker Ltd', isLive: false, connectorInstanceId: 'mt5-instance-1', symbols: [],
  }));
  const reusedAuth = await readMessage(reusedPair);
  assert.equal(reusedAuth.type, 'auth_ok');
  assert.equal(reusedAuth.accountRowId, accountRowId);
  assert.match(reusedAuth.reconnectToken, /^mt5r1\./);

  reusedPair.close();
  await once(reusedPair, 'close');
  const reconnect = new WebSocket(`ws://127.0.0.1:${wsPort}/v1/mt5`);
  t.after(() => reconnect.close());
  await once(reconnect, 'open');
  reconnect.send(JSON.stringify({
    type: 'auth', connectionToken: auth.reconnectToken, accountNumber: '50123456', serverName: 'Broker-Demo',
    brokerName: 'Broker Ltd', isLive: false, connectorInstanceId: 'mt5-instance-1', symbols: [{ platformSymbol: 'XAUUSD.r' }],
  }));
  const reconnectAuth = await readMessage(reconnect);
  assert.equal(reconnectAuth.type, 'auth_ok');
  assert.equal(reconnectAuth.reconnectToken, undefined);

  const request = fetch(`${controlBase}/v1/mt5-context/${accountRowId}?symbol=XAUUSD.r`, {
    headers: { Authorization: `Bearer ${controlSecret}` },
  });
  const delivered = await readMessage(reconnect);
  assert.equal(delivered.type, 'context_request');
  assert.equal(delivered.symbol, 'XAUUSD.r');
  assert.ok(delivered.requestId);
  reconnect.send(JSON.stringify({
    type: 'context_result', requestId: delivered.requestId, ok: true,
    context: {
      account: { accountNumber: '50123456', serverName: 'Broker-Demo', balance: 10000, equity: 9900 },
      symbol: { platformSymbol: 'XAUUSD.r', minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, tickValueLoss: 1.2, digits: 2 },
      tick: { bid: 2500.4, ask: 2500.5, last: 2500.45 },
    },
  }));
  const response = await request;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accountRowId, accountRowId);
  assert.equal(body.context.account.accountNumber, '50123456');
  assert.equal(body.context.symbol.platformSymbol, 'XAUUSD.r');
  assert.equal(body.context.tick.ask, 2500.5);

  const marginRequest = fetch(`${controlBase}/v1/mt5-margin-equivalent/${accountRowId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      referenceSymbol: 'GBPUSD', targetSymbol: 'Synthetic 75', referenceLots: 0.9,
      side: 'BUY', maxMarginPercent: 10,
    }),
  });
  const marginDelivered = await readMessage(reconnect);
  assert.equal(marginDelivered.type, 'margin_request');
  assert.equal(marginDelivered.referenceLots, 0.9);
  assert.equal(marginDelivered.side, 'BUY');
  reconnect.send(JSON.stringify({
    type: 'margin_result', requestId: marginDelivered.requestId, ok: true,
    sizing: {
      accountNumber: '50123456', serverName: 'Broker-Demo',
      referenceSymbol: 'GBPUSD', targetSymbol: 'Synthetic 75',
      referenceLots: 0.9, referenceMargin: 90, accountCapacity: 9000,
      maxMarginPercent: 10, marginBudget: 90, lots: 0.3, expectedMargin: 90,
    },
  }));
  const marginResponse = await marginRequest;
  assert.equal(marginResponse.status, 200);
  const marginBody = await marginResponse.json();
  assert.equal(marginBody.ok, true);
  assert.equal(marginBody.sizing.lots, 0.3);
});