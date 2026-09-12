import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from '../src/security/secret_box.js';

const workspaceId = process.env.WORKSPACE_ID;
const sourceId = process.env.SOURCE_ID;
const accountId = process.env.DEMO_ACCOUNT_ID;
const baseUrl = process.env.BASE_URL || 'https://trade.mkety.com';
const serviceRole = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!process.env.SUPABASE_URL || !serviceRole || !process.env.TRADING_MASTER_KEY) throw new Error('production acceptance credentials are unavailable');
const sb = createClient(process.env.SUPABASE_URL, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fail(message) { throw new Error(message); }
async function data(query, label) { const result = await query; if (result.error) fail(`${label}: ${result.error.message}`); return result.data; }
async function poll(label, fn, attempts = 40) { for (let i = 0; i < attempts; i += 1) { const found = await fn(); if (found) return found; await sleep(2500); } fail(`${label} timed out`); }
async function controls() { const rows = await data(sb.from('trading_runtime_controls').select('control_key,enabled'), 'runtime controls'); return Object.fromEntries((rows || []).map((r) => [r.control_key, r.enabled])); }
async function account() { return (await data(sb.from('trade_accounts').select('id,workspace_id,platform,provider_mode,account_id,account_label,environment,is_active,execution_enabled,live_execution_enabled,lot_sizing_type,lot_value,safety_policy').eq('id', accountId).eq('workspace_id', workspaceId).limit(1), 'account'))?.[0] || null; }
async function patchAccount(patch, label) { const rows = await data(sb.from('trade_accounts').update(patch).eq('id', accountId).eq('workspace_id', workspaceId).eq('environment', 'demo').eq('live_execution_enabled', false).select('id,execution_enabled,live_execution_enabled,safety_policy'), label); if (!rows?.length) fail(`${label} did not persist`); return rows[0]; }
async function postExternal(secret, chatId, messageId, text) {
  const externalEventId = `telegram:${chatId}:${messageId}`;
  const response = await fetch(`${baseUrl}/api/v1/external/mtproto/${encodeURIComponent(sourceId)}/${encodeURIComponent(secret)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, message_id: String(messageId), text, metadata: { acceptance: 'prod-ctrader-demo-e2e' } }), redirect: 'error' });
  let body = {}; try { body = await response.json(); } catch {}
  if (!response.ok) fail(`external ingress HTTP ${response.status}: ${body?.reason || 'failed'}`);
  return { externalEventId, status: response.status };
}

let originalSafetyPolicy = null;
try {
  const c = await controls();
  if (c.trading_access_enabled !== true || c.broker_execution_enabled !== true || c.live_broker_execution_enabled !== false) fail('global runtime safety posture is not demo-ready');
  const live = await data(sb.from('trade_accounts').select('id,execution_enabled,live_execution_enabled').eq('workspace_id', workspaceId).eq('environment', 'live'), 'live accounts');
  if ((live || []).some((x) => x.execution_enabled || x.live_execution_enabled)) fail('live account execution is enabled');
  const a = await account();
  if (!a || a.platform !== 'ctrader' || a.environment !== 'demo' || a.is_active !== true || a.live_execution_enabled !== false) fail('target account is not an active safe cTrader demo');
  if (a.lot_sizing_type !== 'fixed' || Number(a.lot_value) !== 0.01) fail('demo account is not fixed at 0.01 lot');
  originalSafetyPolicy = a.safety_policy && typeof a.safety_policy === 'object' ? { ...a.safety_policy } : {};

  const source = (await data(sb.from('source_connections').select('id,provider_type,is_active,secret_ciphertext,config').eq('id', sourceId).eq('workspace_id', workspaceId).limit(1), 'source'))?.[0];
  if (!source || source.provider_type !== 'external_mtproto' || source.is_active !== true || !source.secret_ciphertext) fail('external MTProto source unavailable');
  const mode = String(source.config?.chat_acceptance_mode || 'allowlist');
  const allowed = Array.isArray(source.config?.allowed_chat_ids) ? source.config.allowed_chat_ids.map(String).filter(Boolean) : [];
  const chatId = mode === 'all_visible' ? '-100987654321' : allowed[0];
  if (!chatId) fail('source has no authorized Telegram chat for acceptance');
  const secret = await decryptSecret(source.secret_ciphertext, process.env.TRADING_MASTER_KEY);
  if (!secret) fail('source secret decrypted empty');
  console.log(`::add-mask::${secret}`);
  console.log(`SOURCE_POLICY_MODE=${mode}`);

  const routes = await data(sb.from('source_destination_routes').select('destination_id').eq('workspace_id', workspaceId).eq('source_connection_id', sourceId).eq('is_active', true), 'routes');
  const destinationIds = (routes || []).map((r) => r.destination_id);
  if (!destinationIds.length) fail('no active source route');
  const destinations = await data(sb.from('trading_destinations').select('id,destination_type,destination_ref,is_active').eq('workspace_id', workspaceId).in('id', destinationIds).eq('is_active', true), 'destinations');
  if (!(destinations || []).some((d) => d.destination_type === 'broker_account' && d.destination_ref === accountId)) fail('demo account is not actively routed');

  const releasedPolicy = { ...originalSafetyPolicy, killSwitch: false };
  const enabledAccount = await patchAccount({ safety_policy: releasedPolicy, execution_enabled: true }, 'demo acceptance gate');
  if (enabledAccount.execution_enabled !== true || enabledAccount.safety_policy?.killSwitch === true || enabledAccount.live_execution_enabled !== false) fail('demo acceptance gate did not enter safe execution state');
  console.log('DEMO_KILL_SWITCH=OFF_FOR_ACCEPTANCE');
  console.log('DEMO_EXECUTION_GATE=ON');

  const seed = Date.now();
  const openIngress = await postExternal(secret, chatId, seed, 'BUY XAUUSD NOW');
  console.log(`OPEN_INGRESS_HTTP=${openIngress.status}`);
  const openEvent = await poll('open event', async () => (await data(sb.from('trading_events').select('id,processing_status,error_code,canonical_intent').eq('workspace_id', workspaceId).eq('source_connection_id', sourceId).eq('external_event_id', openIngress.externalEventId).limit(1), 'open event'))?.[0] || null);
  if (openEvent.error_code) fail(`open event error: ${openEvent.error_code}`);
  console.log(`OPEN_EVENT_ID=${openEvent.id}`);
  console.log(`OPEN_EVENT_STATUS=${openEvent.processing_status}`);

  const group = await poll('position group', async () => (await data(sb.from('position_groups').select('id,status,trade_account_id,source_event_id,canonical_symbol,side').eq('workspace_id', workspaceId).eq('trade_account_id', accountId).eq('source_event_id', openEvent.id).order('created_at', { ascending: false }).limit(1), 'position group'))?.[0] || null);
  const leg = await poll('broker-opened leg', async () => { const legs = await data(sb.from('position_legs').select('id,status,lots,broker_position_id,broker_order_id,opened_at,closed_at').eq('position_group_id', group.id).order('created_at', { ascending: true }), 'position legs'); return (legs || []).find((x) => x.broker_position_id || x.broker_order_id || x.opened_at) || null; });
  if (!leg.broker_position_id && !leg.broker_order_id) fail('broker position/order id missing');
  console.log(`POSITION_GROUP_ID=${group.id}`);
  console.log(`BROKER_POSITION_ID=${leg.broker_position_id || ''}`);
  console.log(`BROKER_ORDER_ID=${leg.broker_order_id || ''}`);
  console.log(`OPEN_LOTS=${leg.lots}`);

  const closeIngress = await postExternal(secret, chatId, seed + 1, 'CLOSE');
  console.log(`CLOSE_INGRESS_HTTP=${closeIngress.status}`);
  const closeEvent = await poll('close event', async () => (await data(sb.from('trading_events').select('id,processing_status,error_code').eq('workspace_id', workspaceId).eq('source_connection_id', sourceId).eq('external_event_id', closeIngress.externalEventId).limit(1), 'close event'))?.[0] || null);
  if (closeEvent.error_code) fail(`close event error: ${closeEvent.error_code}`);
  console.log(`CLOSE_EVENT_ID=${closeEvent.id}`);
  const closed = await poll('closed broker leg', async () => (await data(sb.from('position_legs').select('id,status,broker_position_id,broker_order_id,opened_at,closed_at').eq('id', leg.id).limit(1), 'closed leg'))?.find((x) => x.closed_at) || null);
  console.log(`CLOSED_LEG_ID=${closed.id}`);
  console.log(`CLOSED_AT=${closed.closed_at}`);
  console.log('REAL_DEMO_E2E=PASS');
} finally {
  try {
    const restorePolicy = originalSafetyPolicy ?? { killSwitch: true };
    const restored = await patchAccount({ execution_enabled: false, safety_policy: restorePolicy }, 'demo safety rollback');
    if (restored.execution_enabled !== false || restored.live_execution_enabled !== false || restored.safety_policy?.killSwitch !== true) throw new Error('demo safety posture was not fully restored');
    console.log('DEMO_EXECUTION_GATE=OFF');
    console.log('DEMO_KILL_SWITCH=RESTORED');
  } catch (error) { console.error(`DEMO_GATE_ROLLBACK_FAILED=${error.message}`); process.exitCode = 2; }
  try {
    const c = await controls();
    const a = await account();
    const live = await data(sb.from('trade_accounts').select('id,execution_enabled,live_execution_enabled').eq('workspace_id', workspaceId).eq('environment', 'live'), 'live safety');
    if (c.live_broker_execution_enabled !== false || a?.execution_enabled !== false || a?.live_execution_enabled !== false || a?.safety_policy?.killSwitch !== true || (live || []).some((x) => x.execution_enabled || x.live_execution_enabled)) { console.error('LIVE_SAFETY_POSTURE=FAIL'); process.exitCode = 2; } else console.log('LIVE_SAFETY_POSTURE=PASS');
  } catch (error) { console.error(`SAFETY_RECHECK_FAILED=${error.message}`); process.exitCode = 2; }
}
