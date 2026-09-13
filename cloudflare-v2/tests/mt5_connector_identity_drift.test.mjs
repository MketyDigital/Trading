import test from 'node:test';
import assert from 'node:assert/strict';

import { executeMt5ConnectorAction } from '../src/adapters/mt5_connector_executor_v2.js';

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function action() {
  return { type: 'CANCEL_PENDING', brokerOrderId: 'order-1', idempotencyKey: 'event-1:acct-1:cancel' };
}

function deliveryStoreThatMustNotReserve() {
  return {
    async reserve() { throw new Error('delivery must not be reserved when MT5 identity drifts'); },
    async complete() {},
    async fail() {},
  };
}

function baseOptions(fetchFn) {
  return {
    workspaceId: 'ws-a',
    accountRowId: 'acct-1',
    gatewayUrl: 'https://gateway.example',
    controlSecret: 'control-secret',
    expectedBrokerAccountId: '50123456',
    expectedServerName: 'Broker-Demo',
    expectedEnvironment: 'demo',
    deliveryStore: deliveryStoreThatMustNotReserve(),
    fetchFn,
  };
}

test('MT5 connector execution fails closed before delivery reservation when terminal broker account drifts', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    return response({
      online: true,
      accountRowId: 'acct-1',
      identity: { accountNumber: '50999999', serverName: 'Broker-Demo', environment: 'demo' },
    });
  };

  await assert.rejects(
    executeMt5ConnectorAction(action(), baseOptions(fetchFn)),
    (error) => error?.code === 'MT5_CONNECTOR_BROKER_IDENTITY_MISMATCH' && error?.failureClass === 'TERMINAL',
  );
  assert.equal(calls, 1);
});

test('MT5 connector execution fails closed before delivery reservation when terminal server or environment drifts', async () => {
  for (const identity of [
    { accountNumber: '50123456', serverName: 'Other-Server', environment: 'demo' },
    { accountNumber: '50123456', serverName: 'Broker-Demo', environment: 'live' },
  ]) {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      return response({ online: true, accountRowId: 'acct-1', identity });
    };

    await assert.rejects(
      executeMt5ConnectorAction(action(), baseOptions(fetchFn)),
      (error) => error?.code === 'MT5_CONNECTOR_BROKER_IDENTITY_MISMATCH' && error?.failureClass === 'TERMINAL',
    );
    assert.equal(calls, 1);
  }
});
