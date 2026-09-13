export function withSimplifiedAccountControls(html) {
  let output = String(html);

  output = output.replace(
    'New accounts remain inactive with execution blocked until explicitly enabled through the existing safety controls.',
    'Connected execution accounts have a simple Trading ON/OFF control. Live accounts additionally require explicit real-money permission.',
  );

  output = output.replace(
    "function accountButtons(x){return '<div class=\"actions\" style=\"margin-top:7px\"><button class=\"btn secondary\" data-account-edit=\"'+esc(x.id)+'\">Edit</button><button class=\"btn danger\" data-account-remove=\"'+esc(x.id)+'\">Remove</button></div>'}",
    "function accountButtons(x){var exec=(x.roles||[]).indexOf('execution')>=0;var trading=exec?'<button class=\"btn '+(x.tradingEnabled?'primary':'secondary')+'\" data-account-trading=\"'+esc(x.id)+'\" data-enabled=\"'+(x.tradingEnabled?'true':'false')+'\">'+(x.tradingEnabled?'Trading ON':'Trading OFF')+'</button>':'';var live=exec&&x.environment==='live'?'<button class=\"btn '+(x.liveExecutionEnabled?'danger':'secondary')+'\" data-account-live=\"'+esc(x.id)+'\" data-enabled=\"'+(x.liveExecutionEnabled?'true':'false')+'\">Allow real-money: '+(x.liveExecutionEnabled?'ON':'OFF')+'</button>':'';return '<div class=\"actions\" style=\"margin-top:7px\">'+trading+live+'<button class=\"btn secondary\" data-account-edit=\"'+esc(x.id)+'\">Edit</button><button class=\"btn danger\" data-account-remove=\"'+esc(x.id)+'\">Remove</button></div>'}",
  );

  output = output.replace(
    "+esc(x.active?'Active':'Inactive')+' • '+esc(x.executionEnabled?'Execution flag ON':'Execution flag OFF')+' • '+esc(x.killSwitch?'Kill switch ON':'Kill switch OFF')+'</div>'+accountButtons(x)",
    "+esc(x.active?'Active':'Inactive')+'</div>'+accountButtons(x)",
  );

  const removeAccount = "async function removeAccount(id){if(!confirm('Remove this trading account connection?'))return;try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'DELETE'});msg('Trading account removed.','success');await refreshManagers()}catch(e){msg('Account removal failed: '+String(e.message||e),'error')}}\n";
  const controls = removeAccount
    + "async function toggleAccountTrading(id,enabled){try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({tradingEnabled:!enabled})});msg('Account trading '+(!enabled?'enabled.':'disabled.'),'success');await refreshManagers()}catch(e){msg('Account trading update failed: '+String(e.message||e),'error')}}\n"
    + "async function toggleAccountLive(id,enabled){if(!enabled&&!confirm('Allow real-money trading on this live account? Global live execution must also be enabled before a real order can execute.'))return;try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({allowLiveExecution:!enabled})});msg('Real-money permission '+(!enabled?'enabled.':'disabled.'),'success');await refreshManagers()}catch(e){msg('Real-money permission update failed: '+String(e.message||e),'error')}}\n";
  output = output.replace(removeAccount, controls);

  output = output.replace(
    "function bind(){q('connectCTraderBtn').onclick=connectCTrader;q('showMt5BridgeBtn').onclick=showMt5Bridge;q('showMt5CloudBtn').onclick=showMt5Cloud;document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-source-edit],[data-source-rotate],[data-source-remove],[data-account-edit],[data-account-remove]');if(!t)return;if(t.dataset.sourceEdit)editSource(t.dataset.sourceEdit);else if(t.dataset.sourceRotate)rotateSource(t.dataset.sourceRotate);else if(t.dataset.sourceRemove)removeSource(t.dataset.sourceRemove);else if(t.dataset.accountEdit)editAccount(t.dataset.accountEdit);else if(t.dataset.accountRemove)removeAccount(t.dataset.accountRemove)})}",
    "function bind(){q('connectCTraderBtn').onclick=connectCTrader;q('showMt5BridgeBtn').onclick=showMt5Bridge;q('showMt5CloudBtn').onclick=showMt5Cloud;document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-source-edit],[data-source-rotate],[data-source-remove],[data-account-trading],[data-account-live],[data-account-edit],[data-account-remove]');if(!t)return;if(t.dataset.sourceEdit)editSource(t.dataset.sourceEdit);else if(t.dataset.sourceRotate)rotateSource(t.dataset.sourceRotate);else if(t.dataset.sourceRemove)removeSource(t.dataset.sourceRemove);else if(t.dataset.accountTrading)toggleAccountTrading(t.dataset.accountTrading,t.dataset.enabled==='true');else if(t.dataset.accountLive)toggleAccountLive(t.dataset.accountLive,t.dataset.enabled==='true');else if(t.dataset.accountEdit)editAccount(t.dataset.accountEdit);else if(t.dataset.accountRemove)removeAccount(t.dataset.accountRemove)})}",
  );

  return output;
}
