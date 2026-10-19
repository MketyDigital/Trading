import { applyTradingTradeStateReplicationEvent } from './trading_trade_state_replication.js';
import { applyTradingIngestReplicationEvent } from './trading_ingest_replication.js';
import { applyTradingAccountReplicationEvent } from './trading_account_replication.js';
import { applyTradingAccountFollowerReplicationEvent } from './trading_account_follower_replication.js';
import { applyTradingRouteReplicationEvent } from './trading_route_replication.js';
import { applyTradingDestinationReplicationEvent } from './trading_destination_replication.js';
import { applyTradingDeliveryOperationReplicationEvent } from './trading_delivery_operation_replication.js';
import { applyTradingSourceFeedReplicationEvent } from './trading_source_feed_replication.js';
import { applyTradingSourceConnectionReplicationEvent } from './trading_source_connection_replication.js';
import { applyTradingWorkspaceAccessReplicationEvent } from './trading_workspace_access_replication.js';
import { applyTradingAccessCodeReplicationEvent } from './trading_access_code_replication.js';
import { applyTradingHostnameReplicationEvent } from './trading_hostname_replication.js';
import { applyTradingIngressCollectorReplicationEvent } from './trading_ingress_collector_replication.js';
import { applyTradingRecoveryCursorReplicationEvent } from './trading_recovery_cursor_replication.js';
import { applyTradingAIProviderReplicationEvent } from './trading_ai_provider_replication.js';
import { applyTradingCTraderOAuthStateReplicationEvent } from './trading_ctrader_oauth_state_replication.js';
import { applyTradingLegacyWorkspaceReplicationEvent } from './trading_legacy_workspace_replication.js';
import { applyTradingVIPReplicationEvent } from './trading_vip_replication.js';
import { assertAuthorityEpoch } from './trading_storage_authority.js';

async function applyRuntimeControl(event,{targetAuthority,postgresDatabase}={}){
 const expected=event?.direction==='d1_to_postgres'?'postgres':event?.direction==='postgres_to_d1'?'d1':null;if(expected!==targetAuthority?.kind)throw new Error('Replication target authority does not match event direction');if(event.entityType!=='trading_runtime_control'||event.operation!=='upsert')throw new Error('Unsupported runtime-control replication event');const epoch=assertAuthorityEpoch(event.authorityEpoch);if(assertAuthorityEpoch(targetAuthority.authorityEpoch)!==epoch)throw new Error('Replication event authority epoch does not match target runtime epoch');const p=event.payload||{};if(!p.controlKey||event.entityId!==p.controlKey||typeof p.enabled!=='boolean')throw new Error('Invalid runtime-control replication payload');const source=event.direction==='d1_to_postgres'?'d1':'postgres';
 if(targetAuthority.kind==='d1'){const result=await targetAuthority.binding.prepare(`INSERT INTO trading_runtime_controls(control_key,enabled,updated_by,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority=? AND authority_epoch=?) ON CONFLICT(control_key) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(p.controlKey,p.enabled?1:0,p.updatedBy,p.updatedAt,source,epoch).run();if(Number(result?.meta?.changes||0)!==1)throw new Error('Passive D1 replica rejected runtime-control event');return{applied:true,entityId:event.entityId};}
 if(!postgresDatabase)throw new TypeError('Connected PostgreSQL database is required for replication target');return postgresDatabase.transaction(async query=>{const c=await query(`SELECT active_authority,authority_epoch FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);const a=c.rows?.[0];if(!a||a.active_authority!==source||Number(a.authority_epoch)!==epoch)throw new Error('Passive PostgreSQL replica rejected runtime-control event');await query(`INSERT INTO trading_storage.runtime_controls(control_key,enabled,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(control_key) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`,[p.controlKey,p.enabled,p.updatedBy,p.updatedAt]);return{applied:true,entityId:event.entityId};});
}

/** Routes validated journal entries to their domain appliers; unknown entities fail closed. */
export async function applyTradingReplicationEvent(event,options={}){
 const handlers={
  trade_state_group:applyTradingTradeStateReplicationEvent,
  trading_event:applyTradingIngestReplicationEvent,
  trading_event_revision:applyTradingIngestReplicationEvent,
  trading_interpretation:applyTradingIngestReplicationEvent,
  trade_account:applyTradingAccountReplicationEvent,
  trading_account_follower:applyTradingAccountFollowerReplicationEvent,
  source_destination_route:applyTradingRouteReplicationEvent,
  trading_destinations:applyTradingDestinationReplicationEvent,
  trading_destination_connections:applyTradingDestinationReplicationEvent,
  trading_destination_templates:applyTradingDestinationReplicationEvent,
  destination_delivery:applyTradingDeliveryOperationReplicationEvent,
  operation_journal_entry:applyTradingDeliveryOperationReplicationEvent,
  source_feed:applyTradingSourceFeedReplicationEvent,
  source_connection:applyTradingSourceConnectionReplicationEvent,
  trading_workspace_access:applyTradingWorkspaceAccessReplicationEvent,
  trading_workspace_membership:applyTradingWorkspaceAccessReplicationEvent,
  trading_access_code:applyTradingAccessCodeReplicationEvent,
  trading_access_code_rotation:applyTradingAccessCodeReplicationEvent,
  trading_access_code_redemption:applyTradingAccessCodeReplicationEvent,
  trading_workspace_hostname:applyTradingHostnameReplicationEvent,
  trading_ingress_collector:applyTradingIngressCollectorReplicationEvent,
  trading_recovery_cursor:applyTradingRecoveryCursorReplicationEvent,
  trading_ai_provider:applyTradingAIProviderReplicationEvent,
  trading_ctrader_oauth_state:applyTradingCTraderOAuthStateReplicationEvent,
  trading_legacy_workspace:applyTradingLegacyWorkspaceReplicationEvent,
  trading_vip_member:applyTradingVIPReplicationEvent,
  trading_vip_deposit:applyTradingVIPReplicationEvent,
  trading_runtime_control:applyRuntimeControl,
 };
 const handler=handlers[event?.entityType];if(!handler)throw new Error(`Unsupported trading replication entity: ${String(event?.entityType||'')}`);return handler(event,options);
}
