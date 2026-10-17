import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingIngestStores } from '../src/persistence/trading_ingest_repository.js';
import { applyTradingIngestReplicationEvent } from '../src/persistence/trading_ingest_replication.js';

class D1 {
  constructor(sqlite) { this.sqlite=sqlite; }
  prepare(sql) { const state={sql,values:[]}; const api={bind(...v){state.values=v;return api;},first(){return this.sqlite.prepare(state.sql).get(...state.values)||null;},all(){return{results:this.sqlite.prepare(state.sql).all(...state.values)};},run(){const r=this.sqlite.prepare(state.sql).run(...state.values);return{meta:{changes:Number(r.changes)}};}}; api.first=api.first.bind(this);api.all=api.all.bind(this);api.run=api.run.bind(this);return api; }
  batch(stmts) { this.sqlite.exec('BEGIN');try{const r=stmts.map(s=>s.run());this.sqlite.exec('COMMIT');return r;}catch(e){this.sqlite.exec('ROLLBACK');throw e;} }
}
function setup() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0002_trading_domain_schema.sql',import.meta.url),'utf8'));
  sqlite.prepare(`UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1`).run();
  sqlite.prepare(`INSERT INTO trading_workspace_access(id) VALUES ('ws')`).run();
  sqlite.prepare(`INSERT INTO source_connections(id,workspace_id,source_type,source_instance_id,secret_ciphertext,source_family,provider_type,config) VALUES ('src','ws','telegram','s1','cipher','telegram','external_mtproto',?)`).run(JSON.stringify({chat_acceptance_mode:'allowlist',allowed_chat_ids:['-100']}));
  const binding=new D1(sqlite); const authority={kind:'d1',binding,authorityEpoch:1};
  const store=createTradingIngestStores({authority,masterKey:'mk',idFactory:(()=>{let i=0;return()=>`id-${++i}`;})(),decryptFn:async(v)=>`clear:${v}`});
  return {sqlite,binding,store};
}

test('D1 ingest reservation and its outbox row commit together; duplicates preserve cross-provider identity',async()=>{
  const s=setup();
  const row={workspace_id:'ws',source_connection_id:'src',external_event_id:'42',canonical_event_id:'canonical-42',source_type:'telegram',raw_text:'BUY EURJPY',structured_payload:{side:'BUY'},thread:{},metadata:{}};
  const first=await s.store.eventStore.reserve(row);
  assert.deepEqual(first,{ok:true,duplicate:false,eventId:'id-1'});
  const second=await s.store.eventStore.reserve({...row,source_connection_id:'src-other',external_event_id:'other'});
  assert.equal(second.ok,true);assert.equal(second.duplicate,true);assert.equal(second.eventId,'id-1');
  assert.equal(second.event.text,'BUY EURJPY');
  assert.equal(s.sqlite.prepare(`SELECT COUNT(*) n FROM trading_replication_journal`).get().n,1);
  assert.equal(s.sqlite.prepare(`SELECT COUNT(*) n FROM trading_events`).get().n,1);
  s.sqlite.close();
});

test('D1 interpretation writes are journaled and source lookup decrypts without returning ciphertext',async()=>{
  const s=setup();
  const saved=await s.store.eventStore.reserve({workspace_id:'ws',source_connection_id:'src',external_event_id:'42',source_type:'telegram'});
  await s.store.eventStore.updateInterpretation(saved.eventId,{status:'READY',intent:{side:'BUY'}});
  const source=await s.store.sourceStore.getActiveSource('src');
  assert.equal(source.secret,'clear:cipher');assert.equal('secret_ciphertext' in source,false);
  assert.equal(source.config.allowed_chat_ids[0],'-100');
  const journals=s.sqlite.prepare(`SELECT entity_type,payload_json FROM trading_replication_journal ORDER BY sequence`).all();
  assert.equal(journals.length,2);assert.equal(journals[1].entity_type,'trading_interpretation');
  assert.deepEqual(JSON.parse(journals[1].payload_json).canonical_intent,{side:'BUY'});
  s.sqlite.close();
});

test('D1 ingest write refuses a fenced authority before writing',async()=>{
  const s=setup();s.sqlite.prepare(`UPDATE trading_storage_control SET writes_fenced=1 WHERE singleton_id=1`).run();
  await assert.rejects(()=>s.store.eventStore.reserve({workspace_id:'ws',source_connection_id:'src',external_event_id:'42',source_type:'telegram'}),/write-fenced/);
  assert.equal(s.sqlite.prepare(`SELECT COUNT(*) n FROM trading_events`).get().n,0);s.sqlite.close();
});

test('ingest replication applies validated event and interpretation to passive D1 idempotently',async()=>{
  const s=setup();
  s.sqlite.prepare(`UPDATE trading_storage_control SET active_authority='postgres' WHERE singleton_id=1`).run();
  const target={kind:'d1',binding:s.binding,authorityEpoch:1};
  const event={direction:'postgres_to_d1',authorityEpoch:1,entityType:'trading_event',entityId:'ws:src:42',operation:'upsert',payload:{id:'evt',row:{workspace_id:'ws',source_connection_id:'src',external_event_id:'42',source_type:'telegram',raw_text:'BUY EURJPY',structured_payload:{side:'BUY'},thread:{},metadata:{}}}};
  await applyTradingIngestReplicationEvent(event,{targetAuthority:target});
  await applyTradingIngestReplicationEvent(event,{targetAuthority:target});
  await applyTradingIngestReplicationEvent({...event,entityType:'trading_interpretation',payload:{table:'trading_events',id:'evt',processing_status:'READY',canonical_intent:{side:'BUY'}}},{targetAuthority:target});
  const saved=s.sqlite.prepare(`SELECT processing_status,canonical_intent FROM trading_events WHERE id='evt'`).get();
  assert.equal(saved.processing_status,'READY');assert.deepEqual(JSON.parse(saved.canonical_intent),{side:'BUY'});
  assert.equal(s.sqlite.prepare(`SELECT COUNT(*) n FROM trading_replication_journal`).get().n,0);
  s.sqlite.close();
});
