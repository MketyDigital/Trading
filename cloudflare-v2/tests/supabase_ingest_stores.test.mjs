import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../src/security/secret_box.js';
import { SupabaseSourceStore, SupabaseEventStore } from '../src/persistence/supabase_ingest_stores.js';

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

class FakeSupabase {
  constructor() { this.sources = []; this.events = new Map(); }
  from(name) {
    const db = this;
    if (name === 'source_connections') return {
      select() {
        let instance; let active;
        const chain = {
          eq(column, value) { if (column === 'source_instance_id') instance = value; if (column === 'is_active') active = value; return chain; },
          async maybeSingle() { return { data: db.sources.find((s) => s.source_instance_id === instance && s.is_active === active) || null, error: null }; },
        };
        return chain;
      }
    };
    if (name === 'trading_events') return {
      insert(row) {
        return { async select() {
          const key = `${row.workspace_id}:${row.source_connection_id}:${row.external_event_id}`;
          if (db.events.has(key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
          const saved = { id: `ev-${db.events.size + 1}`, ...row };
          db.events.set(key, saved);
          return { data: [saved], error: null };
        } };
      },
      select() {
        let workspaceId; let sourceId; let externalId;
        const chain = {
          eq(column, value) { if (column === 'workspace_id') workspaceId=value; if (column === 'source_connection_id') sourceId=value; if (column === 'external_event_id') externalId=value; return chain; },
          async maybeSingle() { return { data: db.events.get(`${workspaceId}:${sourceId}:${externalId}`) || null, error: null }; },
        };
        return chain;
      },
      update(patch) {
        let eventId;
        const chain = {
          eq(column, value) { if (column === 'id') eventId=value; if (eventId) { for (const [k,row] of db.events) if (row.id===eventId) db.events.set(k,{...row,...patch}); } return chain; },
          then(resolve) { resolve({ data:null,error:null }); },
        };
        return chain;
      },
    };
    throw new Error(`unexpected table ${name}`);
  }
}

test('source store decrypts active source secret only on server side', async () => {
  const rawKey = new Uint8Array(32); crypto.getRandomValues(rawKey); const masterKey = base64url(rawKey);
  const db = new FakeSupabase();
  db.sources.push({ id:'s1', workspace_id:'ws1', source_type:'telethon_vm', source_instance_id:'vm-1', secret_ciphertext:await encryptSecret('source-hmac', masterKey), is_active:true });
  const store = new SupabaseSourceStore(db, { masterKey });
  const source = await store.getActiveSource('vm-1');
  assert.equal(source.secret, 'source-hmac');
  assert.equal(source.workspace_id, 'ws1');
  assert.equal(source.source_type, 'telethon_vm');
});

test('event store reserves universal event exactly once and returns existing id on duplicate', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseEventStore(db);
  const row = { workspace_id:'ws1',source_connection_id:'s1',external_event_id:'42',event_version:'1.0',source_type:'telegram_mtproto' };
  const first = await store.reserve(row);
  const duplicate = await store.reserve(row);
  assert.deepEqual(first, { ok:true, duplicate:false, eventId:'ev-1' });
  assert.deepEqual(duplicate, { ok:true, duplicate:true, eventId:'ev-1' });
});

test('event store records structured interpretation without storing rendered telegram html as authority', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseEventStore(db);
  const reserved = await store.reserve({ workspace_id:'ws1',source_connection_id:'s1',external_event_id:'43',event_version:'1.0',source_type:'telegram_mtproto' });
  await store.updateInterpretation(reserved.eventId, { status:'READY', source:'deterministic', intent:{ side:'BUY',symbol:{canonical:'XAUUSD'} } });
  const row = [...db.events.values()][0];
  assert.equal(row.processing_status, 'INTERPRETED');
  assert.equal(row.canonical_intent.intent.symbol.canonical, 'XAUUSD');
});
