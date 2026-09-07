import test from 'node:test';
import assert from 'node:assert/strict';

import { MTProtoListenerNode } from '../src/listener/listener_node.js';

function makeState() {
  const data = new Map();
  const storage = {
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, value); },
    async delete(key) { data.delete(key); },
    async setAlarm() {},
  };
  return {
    storage,
    blockConcurrencyWhile(fn) { this.ready = Promise.resolve().then(fn); return this.ready; },
    data,
    ready: Promise.resolve(),
  };
}

function jsonRequest(path, body = {}, method = 'POST') {
  return new Request(`https://listener.internal${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

test('control routes delegate to isolated provider and never expose Telegram session string', async () => {
  const state = makeState();
  const calls = [];
  const provider = {
    async start(input) { calls.push(['start', input]); return { status: 'HEALTHY', connected: true }; },
    async status() { calls.push(['status']); return { status: 'HEALTHY', connected: true, sourceId: 'src-do' }; },
    async authenticate(input) {
      calls.push(['authenticate', input]);
      return { authenticated: true, sessionString: 'must-never-leak' };
    },
    async stop() { calls.push(['stop']); return { status: 'DISABLED', connected: false }; },
    async alarm() { calls.push(['alarm']); return { status: 'HEALTHY', connected: true }; },
  };

  const node = new MTProtoListenerNode(state, {}, { provider });
  await state.ready;

  const startResponse = await node.fetch(jsonRequest('/start', {
    sourceId: 'src-do',
    workspaceId: 'ws-1',
    accountScope: 'acct-1',
    apiId: 123,
    apiHash: 'hash-secret',
    phone: '+10000000000',
  }));
  assert.equal(startResponse.status, 200);
  assert.equal(state.data.get('phone'), '+10000000000');
  assert.deepEqual(calls[0], ['start', {
    sourceId: 'src-do', workspaceId: 'ws-1', accountScope: 'acct-1', apiId: 123, apiHash: 'hash-secret',
  }]);

  const statusResponse = await node.fetch(new Request('https://listener.internal/status'));
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { status: 'HEALTHY', connected: true, sourceId: 'src-do' });

  const authResponse = await node.fetch(jsonRequest('/send_code', { code: '12345' }));
  assert.equal(authResponse.status, 200);
  const authBody = await authResponse.json();
  assert.deepEqual(authBody, { status: 'authenticated' });
  assert.equal(JSON.stringify(authBody).includes('must-never-leak'), false);
  assert.deepEqual(calls.find(([name]) => name === 'authenticate'), ['authenticate', { phone: '+10000000000', code: '12345' }]);

  await node.alarm();
  assert.equal(calls.some(([name]) => name === 'alarm'), true);

  const stopResponse = await node.fetch(jsonRequest('/stop'));
  assert.equal(stopResponse.status, 200);
  assert.deepEqual(await stopResponse.json(), { status: 'DISABLED', connected: false });
});

test('provider failures are sanitized and do not echo credential values', async () => {
  const state = makeState();
  const provider = {
    async start() { throw new Error('failed with apiHash=super-secret sessionString=also-secret'); },
    async status() { return { status: 'DEGRADED', connected: false }; },
    async authenticate() { throw new Error('auth failed'); },
    async stop() { return { status: 'DISABLED', connected: false }; },
    async alarm() { return { status: 'DEGRADED', connected: false }; },
  };
  const node = new MTProtoListenerNode(state, {}, { provider });
  await state.ready;

  const response = await node.fetch(jsonRequest('/start', {
    sourceId: 'src-do', workspaceId: 'ws-1', accountScope: 'acct-1', apiId: 1, apiHash: 'super-secret', phone: '+10000000000',
  }));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual(body, { error: 'MTPROTO_DO_CONTROL_FAILED' });
  assert.equal(JSON.stringify(body).includes('super-secret'), false);
  assert.equal(JSON.stringify(body).includes('also-secret'), false);
});
