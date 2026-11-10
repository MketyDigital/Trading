export function withSimplifiedAccountControls(html) {
  let output = String(html);

  output = output.replace(
    "+' • '+esc(x.executionEnabled?'Execution flag ON':'Execution flag OFF')+' • '+esc(x.killSwitch?'Kill switch ON':'Kill switch OFF')",
    '',
  );

  output = output.replace(
    'New accounts remain inactive with execution blocked until explicitly enabled through the existing safety controls.',
    'Connected execution accounts have a simple Trading ON/OFF control. Live accounts additionally require explicit real-money permission.',
  );

  // Account action markup is owned by dashboard_unified_connections.js.
  // Avoid overwriting that renderer a second time during HTML enhancement.

  output = output.replace(
    "+esc(x.active?'Active':'Inactive')+' • '+esc(x.executionEnabled?'Execution flag ON':'Execution flag OFF')+' • '+esc(x.killSwitch?'Kill switch ON':'Kill switch OFF')+'</div>'+accountButtons(x)",
    "+esc(x.active?'Active':'Inactive')+'</div>'+accountButtons(x)",
  );

  output = output.replace(
    "+esc(x.active?'Active':'Inactive')+' • '+esc(x.executionEnabled?'Execution flag ON':'Execution flag OFF')+' • '+esc(x.killSwitch?'Kill switch ON':'Kill switch OFF')+'</div>'+accountSizingMeta(x)+accountButtons(x)",
    "+esc(x.active?'Active':'Inactive')+'</div>'+accountSizingMeta(x)+accountButtons(x)",
  );

  const removeAccount = "async function removeAccount(id){if(!confirm('Remove this trading account connection?'))return;try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'DELETE'});msg('Trading account removed.','success');await refreshManagers()}catch(e){msg('Account removal failed: '+String(e.message||e),'error')}}\n";
  const controls = removeAccount
    + "async function enableAccountDestination(id,rolesText){var current=String(rolesText||'').split(',').map(function(v){return v.trim().toLowerCase()}).filter(function(v){return v==='source'||v==='execution'});var nextRoles=Array.from(new Set(current.concat(['execution'])));try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({roles:nextRoles})});msg('Account is now available as an execution destination. Turn Trading ON when ready.','success');await refreshManagers()}catch(e){msg('Destination role update failed: '+String(e.message||e),'error')}}\n"
    + "async function toggleAccountTrading(id,enabled){try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({tradingEnabled:!enabled})});msg('Account trading '+(!enabled?'enabled.':'disabled.'),'success');await refreshManagers()}catch(e){msg('Account trading update failed: '+String(e.message||e),'error')}}\n"
    + "async function toggleAccountLive(id,enabled){if(!enabled&&!confirm('Allow real-money trading on this live account? Global live execution must also be enabled before a real order can execute.'))return;try{await api('/api/v1/admin/connections/accounts/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({allowLiveExecution:!enabled})});msg('Real-money permission '+(!enabled?'enabled.':'disabled.'),'success');await refreshManagers()}catch(e){msg('Real-money permission update failed: '+String(e.message||e),'error')}}\n";
  // The injected script's function is followed by the next declaration, not a newline.
  // Match the exact function text and retain its closing brace so the actions
  // exist in the live page (previous replacement silently did nothing).
  const removeAccountIndex = output.indexOf(removeAccount.slice(0, -1));
  if (removeAccountIndex >= 0) {
    output = output.slice(0, removeAccountIndex) + controls.slice(0, -1) + output.slice(removeAccountIndex + removeAccount.length - 1);
  }

  output = output.replace(
    "function bind(){q('connectCTraderBtn').onclick=connectCTrader;q('showMt5BridgeBtn').onclick=showMt5Bridge;q('showMt5CloudBtn').onclick=showMt5Cloud;document.addEventListener('change',function(e){var t=e.target;if(!t)return;if(t.matches('[data-sizing-type],[data-risk-mode]'))syncSizingEditor(t.closest('[data-account-sizing-editor]'))});document.addEventListener('click',function(e){var sizingToggle=e.target.closest&&e.target.closest('[data-account-sizing-toggle]');if(sizingToggle){var card=sizingToggle.closest('[data-account-id]'),editor=card&&card.querySelector('[data-account-sizing-editor]');if(editor){editor.hidden=!editor.hidden;if(!editor.hidden)syncSizingEditor(editor);sizingToggle.textContent=editor.hidden?'Configure sizing':'Close sizing settings'}return}var sizingSave=e.target.closest&&e.target.closest('[data-account-sizing-save]');if(sizingSave){saveAccountSizing(sizingSave.dataset.accountSizingSave,sizingSave).catch(function(error){msg('Sizing update failed: '+String(error.message||error),'error')});return}var t=e.target.closest&&e.target.closest('[data-source-edit],[data-source-rotate],[data-source-remove],[data-account-edit],[data-account-remove]');if(!t)return;if(t.dataset.sourceEdit)editSource(t.dataset.sourceEdit);else if(t.dataset.sourceRotate)rotateSource(t.dataset.sourceRotate);else if(t.dataset.sourceRemove)removeSource(t.dataset.sourceRemove);else if(t.dataset.accountEdit)editAccount(t.dataset.accountEdit);else if(t.dataset.accountRemove)removeAccount(t.dataset.accountRemove)})}",
    "function bind(){q('connectCTraderBtn').onclick=connectCTrader;q('showMt5BridgeBtn').onclick=showMt5Bridge;q('showMt5CloudBtn').onclick=showMt5Cloud;document.addEventListener('change',function(e){var t=e.target;if(!t)return;if(t.matches('[data-sizing-type],[data-risk-mode]'))syncSizingEditor(t.closest('[data-account-sizing-editor]'))});document.addEventListener('click',function(e){var sizingToggle=e.target.closest&&e.target.closest('[data-account-sizing-toggle]');if(sizingToggle){var card=sizingToggle.closest('[data-account-id]'),editor=card&&card.querySelector('[data-account-sizing-editor]');if(editor){editor.hidden=!editor.hidden;if(!editor.hidden)syncSizingEditor(editor);sizingToggle.textContent=editor.hidden?'Configure sizing':'Close sizing settings'}return}var sizingSave=e.target.closest&&e.target.closest('[data-account-sizing-save]');if(sizingSave){saveAccountSizing(sizingSave.dataset.accountSizingSave,sizingSave).catch(function(error){msg('Sizing update failed: '+String(error.message||error),'error')});return}var t=e.target.closest&&e.target.closest('[data-source-edit],[data-source-rotate],[data-source-remove],[data-account-destination],[data-account-trading],[data-account-live],[data-account-edit],[data-account-remove]');if(!t)return;if(t.dataset.sourceEdit)editSource(t.dataset.sourceEdit);else if(t.dataset.sourceRotate)rotateSource(t.dataset.sourceRotate);else if(t.dataset.sourceRemove)removeSource(t.dataset.sourceRemove);else if(t.dataset.accountDestination)enableAccountDestination(t.dataset.accountDestination,t.dataset.accountRoles);else if(t.dataset.accountTrading)toggleAccountTrading(t.dataset.accountTrading,t.dataset.enabled==='true');else if(t.dataset.accountLive)toggleAccountLive(t.dataset.accountLive,t.dataset.enabled==='true');else if(t.dataset.accountEdit)editAccount(t.dataset.accountEdit);else if(t.dataset.accountRemove)removeAccount(t.dataset.accountRemove)})}",
  );

  return output;
}
