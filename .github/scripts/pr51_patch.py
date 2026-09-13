from pathlib import Path

backend = Path('cloudflare-v2/src/http/v1_admin_connections.js')
s = backend.read_text()
s = s.replace(
    "const ACCOUNT_SELECT = 'id,workspace_id,account_label,platform,account_id,server_name,lot_sizing_type,lot_value,is_active,execution_enabled,safety_policy,fast_entry_policy,entry_zone_policy,credential_ciphertext,provider_mode,environment,roles,provider_config,created_at';",
    "const ACCOUNT_SELECT = 'id,workspace_id,account_label,platform,account_id,server_name,lot_sizing_type,lot_value,is_active,execution_enabled,live_execution_enabled,safety_policy,fast_entry_policy,entry_zone_policy,credential_ciphertext,provider_mode,environment,roles,provider_config,created_at';",
)
s = s.replace(
    "    executionEnabled: Boolean(row.execution_enabled ?? row.executionEnabled),\n    killSwitch: safety.killSwitch !== false,",
    "    executionEnabled: Boolean(row.execution_enabled ?? row.executionEnabled),\n    liveExecutionEnabled: Boolean(row.live_execution_enabled ?? row.liveExecutionEnabled),\n    tradingEnabled: Boolean(row.execution_enabled ?? row.executionEnabled) && safety.killSwitch === false,\n    killSwitch: safety.killSwitch !== false,",
)
old = """    const update = {};
    if ('label' in body || 'accountLabel' in body) {"""
new = """    const update = {};
    const environment = String(current.environment ?? '').trim().toLowerCase();
    const hasTradingEnabled = Object.prototype.hasOwnProperty.call(body, 'tradingEnabled');
    const hasAllowLiveExecution = Object.prototype.hasOwnProperty.call(body, 'allowLiveExecution');
    if (hasTradingEnabled && typeof body.tradingEnabled !== 'boolean') {
      return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
    }
    if (hasAllowLiveExecution && typeof body.allowLiveExecution !== 'boolean') {
      return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
    }
    if (hasAllowLiveExecution && environment !== 'live') {
      return json({ ok: false, reason: 'ACCOUNT_LIVE_EXECUTION_NOT_APPLICABLE' }, 400);
    }
    if (hasTradingEnabled) {
      const tradingEnabled = body.tradingEnabled === true;
      update.execution_enabled = tradingEnabled;
      update.safety_policy = { ...safeObject(current.safety_policy), killSwitch: !tradingEnabled };
      if (environment === 'demo') update.live_execution_enabled = false;
      if (!tradingEnabled && environment === 'live') update.live_execution_enabled = false;
    }
    if (hasAllowLiveExecution) update.live_execution_enabled = body.allowLiveExecution === true;
    if ('label' in body || 'accountLabel' in body) {"""
if old not in s:
    raise SystemExit('backend update insertion anchor missing')
s = s.replace(old, new, 1)
backend.write_text(s)

ui = Path('cloudflare-v2/src/dashboard_unified_connections.js')
s = ui.read_text()
s = s.replace(
    'New accounts remain inactive with execution blocked until explicitly enabled through the existing safety controls.',
    'Connected execution accounts have a simple Trading ON/OFF control. Live accounts additionally require explicit real-money permission.',
)
old = "function accountButtons(x){return '<div class=\"actions\" style=\"margin-top:7px\"><button class=\"btn secondary\" data-account-edit=\"'+esc(x.id)+'\">Edit</button><button class=\"btn danger\" data-account-remove=\"'+esc(x.id)+'\">Remove</button></div>'}"
new = "function accountButtons(x){var exec=(x.roles||[]).indexOf('execution')>=0;var trading=exec?'<button class=\"btn '+(x.tradingEnabled?'primary':'secondary')+'\" data-account-trading=\"'+esc(x.id)+'\" data-enabled=\"'+(x.tradingEnabled?'true':'false')+'\">'+(x.tradingEnabled?'Trading ON':'Trading OFF')+'</button>':'';var live=exec&&x.environment==='live'?'<button class=\"btn '+(x.liveExecutionEnabled?'danger':'secondary')+'\" data-account-live=\"'+esc(x.id)+'\" data-enabled=\"'+(x.liveExecutionEnabled?'true':'false')+'\">Allow real-money: '+(x.liveExecutionEnabled?'ON':'OFF')+'</button>':'';return '<div class=\"actions\" style=\"margin-top:7px\">'+trading+live+'<button class=\"btn secondary\" data-account-edit=\"'+esc(x.id)+'\">Edit</button><button class=\"btn danger\" data-account-remove=\"'+esc(x.id)+'\">Remove</button></div>'}"
if old not in s:
    raise SystemExit('accountButtons anchor missing')
s = s.replace(old, new, 1)
old_status = "+esc(x.active?'Active':'Inactive')+' • '+esc(x.executionEnabled?'Execution flag ON':'Execution flag OFF')+' • '+esc(x.killSwitch?'Kill switch ON':'Kill switch OFF')+'</div>'+accountButtons(x)"
new_status = "+esc(x.active?'Active':'Inactive')+'</div>'+accountButtons(x)"
if old_status not in s:
    raise SystemExit('status anchor missing')
s = s.replace(old_status, new_status, 1)
anchor = "async function removeAccount(id){if(!confirm('Remove this trading account connection?'))return;try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'DELETE'});msg('Trading account removed.','success');await refreshManagers()}catch(e){msg('Account removal failed: '+String(e.message||e),'error')}}\n"
addition = anchor + "async function toggleAccountTrading(id,enabled){try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({tradingEnabled:!enabled})});msg('Account trading '+(!enabled?'enabled.':'disabled.'),'success');await refreshManagers()}catch(e){msg('Account trading update failed: '+String(e.message||e),'error')}}\nasync function toggleAccountLive(id,enabled){if(!enabled&&!confirm('Allow real-money trading on this live account? Global live execution must also be enabled before a real order can execute.'))return;try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({allowLiveExecution:!enabled})});msg('Real-money permission '+(!enabled?'enabled.':'disabled.'),'success');await refreshManagers()}catch(e){msg('Real-money permission update failed: '+String(e.message||e),'error')}}\n"
if anchor not in s:
    raise SystemExit('removeAccount anchor missing')
s = s.replace(anchor, addition, 1)
old_bind = "function bind(){q('connectCTraderBtn').onclick=connectCTrader;q('showMt5BridgeBtn').onclick=showMt5Bridge;q('showMt5CloudBtn').onclick=showMt5Cloud;document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-source-edit],[data-source-rotate],[data-source-remove],[data-account-edit],[data-account-remove]');if(!t)return;if(t.dataset.sourceEdit)editSource(t.dataset.sourceEdit);else if(t.dataset.sourceRotate)rotateSource(t.dataset.sourceRotate);else if(t.dataset.sourceRemove)removeSource(t.dataset.sourceRemove);else if(t.dataset.accountEdit)editAccount(t.dataset.accountEdit);else if(t.dataset.accountRemove)removeAccount(t.dataset.accountRemove)})}"
new_bind = "function bind(){q('connectCTraderBtn').onclick=connectCTrader;q('showMt5BridgeBtn').onclick=showMt5Bridge;q('showMt5CloudBtn').onclick=showMt5Cloud;document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-source-edit],[data-source-rotate],[data-source-remove],[data-account-trading],[data-account-live],[data-account-edit],[data-account-remove]');if(!t)return;if(t.dataset.sourceEdit)editSource(t.dataset.sourceEdit);else if(t.dataset.sourceRotate)rotateSource(t.dataset.sourceRotate);else if(t.dataset.sourceRemove)removeSource(t.dataset.sourceRemove);else if(t.dataset.accountTrading)toggleAccountTrading(t.dataset.accountTrading,t.dataset.enabled==='true');else if(t.dataset.accountLive)toggleAccountLive(t.dataset.accountLive,t.dataset.enabled==='true');else if(t.dataset.accountEdit)editAccount(t.dataset.accountEdit);else if(t.dataset.accountRemove)removeAccount(t.dataset.accountRemove)})}"
if old_bind not in s:
    raise SystemExit('bind anchor missing')
s = s.replace(old_bind, new_bind, 1)
ui.write_text(s)
