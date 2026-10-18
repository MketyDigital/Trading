import { assertAuthorityEpoch } from './trading_storage_authority.js';

const EVENT_FIELDS = new Set(['workspace_id','source_connection_id','external_event_id','event_version','source_type','source_external_id','occurred_at','received_at','raw_text','structured_payload','thread','metadata','processing_status','canonical_intent','error_code','canonical_event_id']);
const REVISION_FIELDS = new Set(['workspace_id','trading_event_id','revision_key','event_version','source_type','source_external_id','external_event_id','occurred_at','received_at','raw_text','structured_payload','thread','metadata','processing_status','canonical_intent','error_code']);
const JSON_FIELDS = new Set(['structured_payload','thread','metadata','canonical_intent']);
const TABLES = new Set(['trading_events','trading_event_revisions']);

function validate(event, targetKind) {
  const expectedTarget = event?.direction === 'd1_to_postgres' ? 'postgres' : event?.direction === 'postgres_to_d1' ? 'd1' : null;
  if (!event || expectedTarget !== targetKind) throw new Error('Replication target authority does not match event direction');
  const epoch = assertAuthorityEpoch(event.authorityEpoch);
  if (event.operation !== 'upsert') throw new Error('Unsupported trading ingest replication operation');
  if (event.entityType === 'trading_event' || event.entityType === 'trading_event_revision') {
    const row = event.payload?.row;
    const fields = event.entityType === 'trading_event' ? EVENT_FIELDS : REVISION_FIELDS;
    if (!row || !event.payload.id) throw new Error('Invalid trading ingest replication payload');
    for (const key of Object.keys(row)) if (!fields.has(key)) throw new Error(`Unsupported trading ingest field: ${key}`);
    return { epoch, mode:'insert', table:event.entityType === 'trading_event' ? 'trading_events' : 'trading_event_revisions', id:String(event.payload.id), row };
  }
  if (event.entityType === 'trading_interpretation') {
    const p = event.payload || {};
    const table = String(p.table || '').replace(/^trading_storage\./,'');
    if (!TABLES.has(table) || !p.id || !['RECEIVED','READY','MANAGEMENT','NO_ACTION','NEEDS_REVIEW'].includes(String(p.processing_status))) throw new Error('Invalid trading interpretation replication payload');
    return { epoch, mode:'update', table, id:String(p.id), row:{processing_status:p.processing_status,canonical_intent:p.canonical_intent ?? null,error_code:p.error_code ?? null} };
  }
  throw new Error('Unsupported trading ingest replication entity');
}

function encode(row) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key, JSON_FIELDS.has(key) && value != null ? JSON.stringify(value) : value]));
}

/** Applies an ingest event to the passive authority only; never appends a second outbox event. */
export async function applyTradingIngestReplicationEvent(event, { targetAuthority, postgresDatabase } = {}) {
  if (!targetAuthority || !['d1','postgres'].includes(targetAuthority.kind)) throw new TypeError('Resolved replication target authority is required');
  const item=validate(event,targetAuthority.kind);
  if (assertAuthorityEpoch(targetAuthority.authorityEpoch)!==item.epoch) throw new Error('Replication event authority epoch does not match target runtime epoch');
  const sourceAuthority=event.direction==='d1_to_postgres'?'d1':'postgres';
  const row=encode(item.row);
  if(targetAuthority.kind==='d1'){
    const db=targetAuthority.binding;
    const authority=`EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority=? AND authority_epoch=?)`;
    let statement;
    if(item.mode==='insert'){
      const columns=Object.keys(row); const vals=columns.map(()=>'?').join(',');
      statement=db.prepare(`INSERT INTO ${item.table} (id,${columns.join(',')}) SELECT ?,${vals} WHERE ${authority} ON CONFLICT DO NOTHING`).bind(item.id,...columns.map(k=>row[k]),sourceAuthority,item.epoch);
    }else{
      const entries=Object.entries(row); const sets=entries.map(([k])=>`${k}=?`).join(',');
      statement=db.prepare(`UPDATE ${item.table} SET ${sets} WHERE id=? AND ${authority}`).bind(...entries.map(([,v])=>v),item.id,sourceAuthority,item.epoch);
    }
    const result=await db.batch([statement]);
    if(Number(result?.[0]?.meta?.changes||0)!==1 && item.mode==='update') throw new Error('Passive D1 replica could not update interpretation');
    if(item.mode==='insert' && Number(result?.[0]?.meta?.changes||0)!==1){
      const found=await db.prepare(`SELECT id FROM ${item.table} WHERE id=?`).bind(item.id).first();
      if(!found) throw new Error('Passive D1 replica rejected stale or mismatched authority epoch');
    }
    return {applied:true,entityId:event.entityId};
  }
  if(!postgresDatabase) throw new TypeError('Connected PostgreSQL database is required for replication target');
  return postgresDatabase.transaction(async query=>{
    const control=await query(`SELECT active_authority,authority_epoch FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
    const persisted=control.rows?.[0];
    if(!persisted||persisted.active_authority!==sourceAuthority||Number(persisted.authority_epoch)!==item.epoch) throw new Error('Passive PostgreSQL replica rejected stale or mismatched authority epoch');
    const entries=Object.entries(row);
    if(item.mode==='insert'){
      const cols=entries.map(([k])=>k); const params=entries.map((_,i)=>`$${i+2}`).join(',');
      await query(`INSERT INTO trading_storage.${item.table}(id,${cols.join(',')}) VALUES($1,${params}) ON CONFLICT DO NOTHING`,[item.id,...entries.map(([,v])=>v)]);
    }else{
      const sets=entries.map(([k],i)=>`${k}=$${i+1}${k==='canonical_intent'?'::jsonb':''}`).join(',');
      const result=await query(`UPDATE trading_storage.${item.table} SET ${sets} WHERE id=$${entries.length+1}`,[...entries.map(([,v])=>v),item.id]);
      if(Number(result.rowCount||0)!==1) throw new Error('Passive PostgreSQL replica could not update interpretation');
    }
    return {applied:true,entityId:event.entityId};
  });
}
