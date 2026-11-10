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

  // The broker-derived exposure fields must survive the gateway's identity/symbol
  // sanitizer. This is the regression for the 2026-11-09 FBS LIVE incident.
  async function exposureProbe(exposure, expectedStatus) {
    const pending = fetch(`${controlBase}/v1/mt5-context/${accountRowId}?symbol=XAUUSD.r&includeExposure=true`, {
      headers: { Authorization: `Bearer ${controlSecret}` },
    });
    const question = await readMessage(reconnect);
    assert.equal(question.type, 'context_request');
    assert.equal(question.includeExposure, true);
    const context = {
      account: { accountNumber: '50123456', serverName: 'Broker-Demo', balance: 10000, equity: 9900 },
      symbol: { platformSymbol: 'XAUUSD.r', minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, tickValueLoss: 1.2, digits: 2 },
      tick: { bid: 2500.4, ask: 2500.5 },
    };
    if (exposure !== undefined) context.exposure = exposure;
    reconnect.send(JSON.stringify({ type: 'context_result', requestId: question.requestId, ok: true, context }));
    const result = await pending;
    assert.equal(result.status, expectedStatus);
    return result.json();
  }
  const exposed = await exposureProbe({ currentOpenRiskPercent: 4.25, currentDailyPnlPercent: -1.5 }, 200);
  assert.deepEqual(exposed.context.exposure, { currentOpenRiskPercent: 4.25, currentDailyPnlPercent: -1.5 });
  const omitted = await exposureProbe(undefined, 409);
  assert.equal(omitted.reason, 'MT5_EXPOSURE_CONTEXT_MISSING');
  for (const invalid of [
    { currentOpenRiskPercent: null, currentDailyPnlPercent: 0 },
    { currentOpenRiskPercent: -1, currentDailyPnlPercent: 0 },
    { currentOpenRiskPercent: '0', currentDailyPnlPercent: 0 },
    { currentOpenRiskPercent: 0, currentDailyPnlPercent: false },
  ]) {
    const rejected = await exposureProbe(invalid, 409);
    assert.equal(rejected.reason, 'MT5_CONTEXT_INVALID');
  }

  const sizingRequest = fetch(`${controlBase}/v1/mt5-broker-sizing/${accountRowId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${controlSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'symbol_equivalent',
      referenceSymbol: 'GBPUSD',
      targetSymbol: 'Synthetic 75',
      maximumLots: 0.9,
      side: 'BUY',
    }),
  });
  const sizingDelivered = await readMessage(reconnect);
  assert.equal(sizingDelivered.type, 'sizing_request');
  assert.equal(sizingDelivered.mode, 'symbol_equivalent');
  assert.equal(sizingDelivered.maximumLots, 0.9);
  assert.equal(sizingDelivered.side, 'BUY');
  reconnect.send(JSON.stringify({
    type: 'sizing_result', requestId: sizingDelivered.requestId, ok: true,
    sizing: {
      accountNumber: '50123456', serverName: 'Broker-Demo',
      mode: 'symbol_equivalent', referenceSymbol: 'GBPUSD', targetSymbol: 'Synthetic 75',
      referenceLots: 0.9, referenceMargin: 90, marginBudget: 90, lots: 0.3, expectedMargin: 90,
    },
  }));
  const sizingResponse = await sizingRequest;
  assert.equal(sizingResponse.status, 200);
  const sizingBody = await sizingResponse.json();
  assert.equal(sizingBody.ok, true);
  assert.equal(sizingBody.sizing.lots, 0.3);

  const positionHistoryRequest = fetch(`${controlBase}/v1/mt5-position-close/${accountRowId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${controlSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionId: '7001', openedAt: 1770000000000 }),
  });
  const positionHistoryDelivered = await readMessage(reconnect);
  assert.equal(positionHistoryDelivered.type, 'position_close_status_request');
  assert.equal(positionHistoryDelivered.positionId, '7001');
  assert.equal(positionHistoryDelivered.openedAt, 1770000000000);
  reconnect.send(JSON.stringify({ type: 'position_close_status_result', requestId: positionHistoryDelivered.requestId, ok: true,
    snapshot: { accountId: '50123456', serverName: 'Broker-Demo', environment: 'demo', isLive: false,
      positionId: '7001', isOpen: false, initialLots: 0.1, closedLots: 0.1,
      deals: [{ dealId: '8001', positionId: '7001', lots: 0.1, entry: 'OUT', reason: 'TP' }] } }));
  const positionHistoryResponse = await positionHistoryRequest;
  assert.equal(positionHistoryResponse.status, 200);
  const positionHistoryBody = await positionHistoryResponse.json();
  assert.equal(positionHistoryBody.snapshot.positionId, '7001');
  assert.equal(positionHistoryBody.snapshot.deals[0].reason, 'TP');
});
