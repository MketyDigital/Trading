import test from 'node:test';
import assert from 'node:assert/strict';

import { createMtprotoDoProvider } from '../src/sources/mtproto/do_provider.js';

function createState(initial = {}) {
  const data = new Map(Object.entries(initial));
  const alarms = [];
  return {
    storage: {
      async get(key) { return data.get(key); },
      async put(key, value) { data.set(key, value); },
      async delete(key) { data.delete(key); },
      async setAlarm(value) { alarms.push(value); },
    },
    data,
    alarms,
  };
}

function createFakeClient() {
  const handlers = [];
  return {
    connected: false,
    importedSession: null,
    onNewMessage: { add(handler) { handlers.push(handler); } },
    async importSession(value) { this.importedSession = value; },
    async connect() { this.connected = true; },
    async close() { this.connected = false; },
    isConnected() { return this.connected; },
    async emit(message) { for (const handler of handlers) await handler(message); },
  };
}

test('persists mtcute storage and enables catch-up without exposing session credentials', async () => {
  const state = createState({ session_string: 'super-secret-session' });
  const created = [];
  const client = createFakeClient();
  const provider = createMtprotoDoProvider({
    state,
    now: () => 1_000,
    reconnectDelayMs: 30_000,
    clientFactory(options) { created.push(options); return client; },
    enqueueSourceEvent: async () => {},
  });

  await provider.start({
    sourceId: 'src-do',
    workspaceId: 'ws-1',
    accountScope: 'acct-1',
    apiId: 123,
    apiHash: 'hash-secret',
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].updates.catchUp, true);
  await created[0].storage.set('updates_state', { pts: 55 });
  assert.deepEqual(await created[0].storage.get('updates_state'), { pts: 55 });
  assert.equal(client.importedSession, 'super-secret-session');

  const status = await provider.status();
  assert.equal(status.status, 'HEALTHY');
  assert.equal(status.connected, true);
  assert.equal(status.sourceId, 'src-do');
  assert.equal(status.workspaceId, 'ws-1');
  assert.equal(status.accountScope, 'acct-1');
  assert.equal('sessionString' in status, false);
  assert.equal('session_string' in status, false);
  assert.equal('apiHash' in status, false);
  assert.equal(JSON.stringify(status).includes('super-secret-session'), false);
});

test('alarm reconnect is scoped to this source and reports disconnected health before recovery', async () => {
  const state = createState();
  const clients = [createFakeClient(), createFakeClient()];
  let created = 0;
  const provider = createMtprotoDoProvider({
    state,
    now: () => 5_000,
    reconnectDelayMs: 10_000,
    clientFactory() { return clients[created++]; },
    enqueueSourceEvent: async () => {},
  });

  await provider.start({ sourceId: 'src-a', workspaceId: 'ws-a', accountScope: 'acct-a', apiId: 1, apiHash: 'h' });
  clients[0].connected = false;

  const degraded = await provider.status();
  assert.equal(degraded.status, 'DEGRADED');
  assert.equal(degraded.connected, false);

  await provider.alarm();
  assert.equal(created, 2);
  assert.equal((await provider.status()).status, 'HEALTHY');
  assert.equal(state.alarms.at(-1), 15_000);
});

test('incoming Telegram event uses queue-compatible native identity and ignores outgoing messages', async () => {
  const state = createState();
  const client = createFakeClient();
  const deliveries = [];
  const provider = createMtprotoDoProvider({
    state,
    clientFactory: () => client,
    enqueueSourceEvent: async (source, event) => deliveries.push({ source, event }),
  });

  await provider.start({ sourceId: 'src-do', workspaceId: 'ws-1', accountScope: 'acct-1', apiId: 1, apiHash: 'h' });
  await client.emit({ isOutgoing: true, id: 8, chat: { id: -1001 }, text: 'ignore' });
  await client.emit({
    isOutgoing: false,
    id: 9,
    chat: { id: -1001 },
    text: 'BUY XAUUSD',
    date: new Date('2026-09-02T10:00:00.000Z'),
    replyToMessageId: 7,
    media: { kind: 'photo' },
  });

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].source.id, 'src-do');
  assert.equal(deliveries[0].event.source_external_id, 'acct-1');
  assert.equal(deliveries[0].event.external_event_id, 'telegram:-1001:9');
  assert.deepEqual(deliveries[0].event.metadata.native_identity, { chat_id: '-1001', message_id: '9' });
  assert.equal(deliveries[0].event.metadata.account_scope, 'acct-1');
  assert.equal(deliveries[0].event.metadata.media, true);
  assert.equal(deliveries[0].event.thread.reply_to_event_id, '7');
});

test('one provider failure does not mutate another provider state', async () => {
  const stateA = createState();
  const stateB = createState();
  const badClient = createFakeClient();
  badClient.connect = async () => { throw new Error('telegram unavailable'); };
  const goodClient = createFakeClient();

  const providerA = createMtprotoDoProvider({ state: stateA, clientFactory: () => badClient, enqueueSourceEvent: async () => {} });
  const providerB = createMtprotoDoProvider({ state: stateB, clientFactory: () => goodClient, enqueueSourceEvent: async () => {} });

  await assert.rejects(
    () => providerA.start({ sourceId: 'src-a', workspaceId: 'ws-a', accountScope: 'acct-a', apiId: 1, apiHash: 'ha' }),
    /telegram unavailable/,
  );
  await providerB.start({ sourceId: 'src-b', workspaceId: 'ws-b', accountScope: 'acct-b', apiId: 2, apiHash: 'hb' });

  assert.equal((await providerA.status()).status, 'DEGRADED');
  assert.equal((await providerB.status()).status, 'HEALTHY');
  assert.equal((await providerB.status()).workspaceId, 'ws-b');
});
