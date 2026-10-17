import { decryptSecret } from '../security/secret_box.js';
import { verifyTradingStorageAuthority } from './trading_storage_authority.js';
import { prepareD1ReplicationAppendStatements } from './d1_replication_journal.js';
import { appendPostgresReplicationEventInTransaction } from './postgres_replication_journal.js';

const EVENT_FIELDS = new Set(['workspace_id','source_connection_id','external_event_id','event_version','source_type','source_external_id','occurred_at','received_at','raw_text','structured_payload','thread','metadata','processing_status','canonical_intent','error_code','canonical_event_id']);
const REVISION_FIELDS = new Set(['workspace_id','trading_event_id','revision_key','event_version','source_type','source_external_id','external_event_id','occurred_at','received_at','raw_text','structured_payload','thread','metadata','processing_status','canonical_intent','error_code']);
const EVENT_SELECT = `id,event_version,source_type,source_external_id,external_event_id,occurred_at,received_at,created_at,raw_text,structured_payload,thread,metadata,processing_status,canonical_intent,error_code`;
const SOURCE_SELECT = `id,workspace_id,source_type,source_instance_id,source_family,provider_type,external_identity,config,secret_ciphertext,settings,is_active`;

function json(value) { return value == null ? null : JSON.stringify(value); }
function dbRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of ['structured_payload','thread','metadata','canonical_intent','config','settings']) {
    if (typeof out[key] === 'string') { try { out[key] = JSON.parse(out[key]); } catch { out[key] = null; } }
  }
  return out;
}
function eventShape(row = {}) {
  if (!row.external_event_id) return null;
  return { version: String(row.event_version || '1.0'), source_type: row.source_type ?? null,
    source_external_id: row.source_external_id ?? null, external_event_id: String(row.external_event_id),
    occurred_at: row.occurred_at || row.created_at || null, received_at: row.received_at || row.created_at || row.occurred_at || null,
    text: String(row.raw_text ?? ''), structured_payload: row.structured_payload && typeof row.structured_payload === 'object' ? row.structured_payload : {},
    thread: row.thread && typeof row.thread === 'object' ? row.thread : {}, metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {} };
}
function interpretationShape(row = {}) {
  if (!['READY','MANAGEMENT','NO_ACTION','NEEDS_REVIEW'].includes(String(row.processing_status || ''))) return null;
  return { status: row.processing_status, ...(row.canonical_intent && typeof row.canonical_intent === 'object' ? { intent: row.canonical_intent } : {}), ...(row.error_code ? { reason: String(row.error_code) } : {}) };
}
function normalized(row, fields, jsonFields) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!fields.has(key)) throw new Error(`Unsupported ingest field: ${key}`);
    out[key] = jsonFields.has(key) ? json(value) : value;
  }
  return out;
}
function returnDuplicate(row, key) {
  const event = eventShape(dbRow(row));
  const interpretation = interpretationShape(dbRow(row));
  return { ok: true, duplicate: true, [key]: row.id, ...(event ? { event } : {}), ...(interpretation ? { interpretation } : {}) };
}
function sourceAcceptsChat(row, chatId, identity) {
  const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {};
  const mode = String(config.chat_acceptance_mode || 'allowlist').trim().toLowerCase();
  const allowed = Array.isArray(config.allowed_chat_ids) ? config.allowed_chat_ids.map(x => String(x ?? '').trim()).filter(Boolean) : [];
  if (identity && row.external_identity && String(row.external_identity).trim() !== String(identity).trim()) return false;
  return mode === 'all_visible' || (mode === 'allowlist' && allowed.includes(String(chatId).trim()));
}

/** Backend-neutral durable ingest stores. Runtime wiring remains a separate cutover gate. */
export function createTradingIngestStores({ authority, postgresDatabase, masterKey, decryptFn = decryptSecret, idFactory = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  if (!authority || !['d1','postgres'].includes(authority.kind)) throw new TypeError('Resolved D1 or PostgreSQL authority is required');
  if (authority.kind === 'postgres' && !postgresDatabase) throw new TypeError('Connected PostgreSQL database is required');
  if (!masterKey) throw new TypeError('Trading master key is required');
  const d1 = authority.kind === 'd1';
  const table = name => d1 ? name : `trading_storage.${name}`;
  const read = async (sql, params = []) => {
    if (d1) {
      const result = params.length ? await authority.binding.prepare(sql).bind(...params).all() : await authority.binding.prepare(sql).all();
      return result.results || [];
    }
    return (await postgresDatabase.query(sql, params)).rows || [];
  };
  async function sourceRows(sql, params) { return read(sql, params); }
  async function persist({ entityType, entityId, rowId, tableName, values, jsonFields, uniqueLookup, idField }) {
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    const payload = Object.fromEntries(Object.entries(values).map(([k,v]) => [k, jsonFields.has(k) && v != null ? JSON.parse(v) : v]));
    const mutation = { authorityEpoch: authority.authorityEpoch, direction: d1 ? 'd1_to_postgres' : 'postgres_to_d1', idempotencyKey: `ingest:${entityType}:${idFactory()}`, entityType, entityId, operation: 'upsert', payload: { id: rowId, row: payload } };
    if (d1) {
      const cols = Object.keys(values); const params = cols.map(() => '?').join(',');
      const insert = authority.binding.prepare(`INSERT INTO ${tableName} (id,${cols.join(',')}) SELECT ?,${params} WHERE EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0) ON CONFLICT DO NOTHING`).bind(rowId, ...cols.map(k => values[k]), authority.authorityEpoch);
      const existsGuard = `EXISTS (SELECT 1 FROM ${tableName} WHERE id = ?)`;
      const journal = prepareD1ReplicationAppendStatements(authority.binding, mutation, { now: () => now(), guardSql: `${existsGuard} AND EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`, guardValues: [rowId, authority.authorityEpoch] });
      const results = await authority.binding.batch([insert, ...journal.statements]);
      const inserted = Number(results?.[0]?.meta?.changes || 0) === 1;
      if (inserted) return { ok: true, duplicate: false, [idField]: rowId };
    } else {
      const result = await postgresDatabase.transaction(async query => {
        const a = await query(`SELECT active_authority,authority_epoch,writes_fenced FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
        const control = a.rows?.[0];
        if (!control || control.active_authority !== 'postgres' || Number(control.authority_epoch) !== Number(authority.authorityEpoch) || control.writes_fenced !== false) throw new Error('Trading storage authority changed or is fenced during ingest write');
        const cols = Object.keys(values); const binds = cols.map((_,i) => `$${i+2}`).join(',');
        const ins = await query(`INSERT INTO ${tableName} (id,${cols.join(',')}) VALUES ($1,${binds}) ON CONFLICT DO NOTHING RETURNING id`, [rowId, ...cols.map(k => values[k])]);
        if (ins.rows?.[0]) { await appendPostgresReplicationEventInTransaction(query, mutation, { now: () => new Date(now()) }); return { inserted: true }; }
        return { inserted: false };
      });
      if (result.inserted) return { ok: true, duplicate: false, [idField]: rowId };
    }
    const found = await read(`SELECT id,${EVENT_SELECT} FROM ${tableName} WHERE ${uniqueLookup.map((k,i) => `${k} = ${d1 ? '?' : `$${i+1}`}`).join(' AND ')} LIMIT 1`, uniqueLookup.map(k => values[k]));
    if (found[0]) return returnDuplicate(found[0], idField);
    return { ok: false, duplicate: false, error: 'event reservation failed' };
  }
  const eventStore = {
    async getById(workspaceId, id) {
      if (!workspaceId || !id) return null;
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      const rows = await read(`SELECT id,workspace_id,source_connection_id,source_type,source_external_id,external_event_id,occurred_at,received_at,created_at,raw_text,structured_payload,thread,metadata,processing_status,canonical_intent,error_code FROM ${table('trading_events')} WHERE workspace_id=${d1 ? '?' : '$1'} AND id=${d1 ? '?' : '$2'} LIMIT 1`, [String(workspaceId), String(id)]);
      return dbRow(rows[0]) || null;
    },
    async reserve(row) {
      const values = normalized(row, EVENT_FIELDS, new Set(['structured_payload','thread','metadata','canonical_intent']));
      const unique = values.canonical_event_id ? ['workspace_id','canonical_event_id'] : ['workspace_id','source_connection_id','external_event_id'];
      return persist({ entityType:'trading_event', entityId:`${values.workspace_id}:${values.canonical_event_id || `${values.source_connection_id}:${values.external_event_id}`}`, rowId:idFactory(), tableName:table('trading_events'), values, jsonFields:new Set(['structured_payload','thread','metadata','canonical_intent']), uniqueLookup:unique, idField:'eventId' });
    },
    async reserveRevision(row) {
      const values = normalized(row, REVISION_FIELDS, new Set(['structured_payload','thread','metadata','canonical_intent']));
      return persist({ entityType:'trading_event_revision', entityId:`${values.trading_event_id}:${values.revision_key}`, rowId:idFactory(), tableName:table('trading_event_revisions'), values, jsonFields:new Set(['structured_payload','thread','metadata','canonical_intent']), uniqueLookup:['trading_event_id','revision_key'], idField:'revisionId' });
    },
    async updateInterpretation(id, interpretation = {}) { return update('trading_events', id, interpretation); },
    async updateRevisionInterpretation(id, interpretation = {}) { return update('trading_event_revisions', id, interpretation); },
    async findByExternalEventId(workspaceId, externalEventIds = []) {
      const candidates = [...new Set((Array.isArray(externalEventIds) ? externalEventIds : [externalEventIds]).map(value => String(value ?? '').trim()).filter(Boolean))];
      if (!workspaceId || !candidates.length) return null;
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      const placeholders = candidates.map((_, index) => d1 ? '?' : `$${index + 2}`).join(',');
      const rows = await read(`SELECT id,workspace_id,external_event_id FROM ${table('trading_events')} WHERE workspace_id=${d1 ? '?' : '$1'} AND external_event_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 1`, [String(workspaceId), ...candidates]);
      return rows[0] || null;
    },
    async listReadyRecoveryCandidates({ oldest, newest, cursor = null, limit = 50 } = {}) {
      const bounded = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 50));
      if (!oldest || !newest) throw new TypeError('Recovery scan time bounds are required');
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      const where = [`processing_status='READY'`, `received_at >= ${d1 ? '?' : '$1'}`, `received_at <= ${d1 ? '?' : '$2'}`];
      const values = [String(oldest), String(newest)];
      if (cursor?.last_received_at && cursor?.last_event_id) {
        const a = d1 ? '?' : '$3'; const b = d1 ? '?' : '$4';
        where.push(`(received_at > ${a} OR (received_at = ${a} AND id > ${b}))`);
        values.push(String(cursor.last_received_at), String(cursor.last_event_id));
      }
      const limitSlot = d1 ? '?' : `$${values.length + 1}`;
      values.push(bounded);
      const rows = await read(`SELECT id,workspace_id,source_connection_id,source_external_id,external_event_id,occurred_at,received_at,raw_text,structured_payload,thread,metadata,processing_status,canonical_intent FROM ${table('trading_events')} WHERE ${where.join(' AND ')} ORDER BY received_at ASC,id ASC LIMIT ${limitSlot}`, values);
      return rows.map(dbRow);
    },
  };
  async function update(tableName, id, interpretation) {
    if (!id) return;
    const status = String(interpretation.status || 'NEEDS_REVIEW');
    const values = { processing_status: status, canonical_intent: json(interpretation.intent || null), error_code: status === 'READY' || status === 'MANAGEMENT' ? null : (interpretation.reason || null) };
    const mutation = { authorityEpoch:authority.authorityEpoch, direction:d1?'d1_to_postgres':'postgres_to_d1', idempotencyKey:`ingest-interpretation:${tableName}:${id}:${idFactory()}`, entityType:'trading_interpretation', entityId:String(id), operation:'upsert', payload:{ table:tableName, id:String(id), ...values, canonical_intent: interpretation.intent || null } };
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    if (d1) {
      const stmt = authority.binding.prepare(`UPDATE ${tableName} SET processing_status=?,canonical_intent=?,error_code=? WHERE id=? AND EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`).bind(values.processing_status, values.canonical_intent, values.error_code, String(id), authority.authorityEpoch);
      const guard = `EXISTS (SELECT 1 FROM ${tableName} WHERE id=?) AND EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`;
      const journal = prepareD1ReplicationAppendStatements(authority.binding, mutation, { now:() => now(), guardSql:guard, guardValues:[String(id), authority.authorityEpoch] });
      await authority.binding.batch([stmt,...journal.statements]);
    } else await postgresDatabase.transaction(async query => {
      const control=await query(`SELECT singleton_id FROM trading_storage.authority_control WHERE singleton_id=1 AND active_authority='postgres' AND authority_epoch=$1 AND writes_fenced=false FOR SHARE`,[authority.authorityEpoch]);
      if (!control.rows?.[0]) throw new Error('Trading storage authority changed or is fenced during ingest interpretation update');
      const updated = await query(`UPDATE ${table(tableName)} SET processing_status=$1,canonical_intent=$2::jsonb,error_code=$3 WHERE id=$4`,[values.processing_status, values.canonical_intent, values.error_code, String(id)]);
      if (Number(updated.rowCount || 0) !== 1) return;
      await appendPostgresReplicationEventInTransaction(query, mutation,{now:()=>new Date(now())});
    });
  }
  const sourceStore = {
    async getActiveSource(sourceId) {
      if (!sourceId) return null;
      await verifyTradingStorageAuthority(authority,{postgresDatabase});
      const rows=await sourceRows(`SELECT ${SOURCE_SELECT} FROM ${table('source_connections')} WHERE id=${d1?'?':'$1'} AND is_active=${d1?'1':'true'} LIMIT 1`,[String(sourceId)]);
      const row=dbRow(rows[0]); if(!row?.id||!row.secret_ciphertext)return null;
      const secret=await decryptFn(row.secret_ciphertext,masterKey); delete row.secret_ciphertext;
      return {...row,config:row.config||{},settings:row.settings||{},secret};
    },
    async findActiveExternalMtprotoSourcesForChat(chatId,{externalIdentity=null}={}) {
      const chat=String(chatId??'').trim(); if(!chat)return[];
      await verifyTradingStorageAuthority(authority,{postgresDatabase});
      const rows=await sourceRows(`SELECT ${SOURCE_SELECT} FROM ${table('source_connections')} WHERE provider_type='external_mtproto' AND is_active=${d1?'1':'true'}` ,[]);
      const result=[];
      for(const source of rows.map(dbRow).filter(r=>r?.id&&r.secret_ciphertext&&sourceAcceptsChat(r,chat,externalIdentity))){const secret=await decryptFn(source.secret_ciphertext,masterKey);delete source.secret_ciphertext;result.push({...source,config:source.config||{},settings:source.settings||{},secret});}
      return result;
    },
  };
  return { sourceStore, eventStore };
}
