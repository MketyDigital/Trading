export function renderDashboard(env = {}) {
  const runtime = {
    tradingAccessEnabled: String(env.TRADING_ACCESS_ENABLED ?? '').toLowerCase() === 'true',
    brokerExecutionEnabled: String(env.BROKER_EXECUTION_ENABLED ?? '').toLowerCase() === 'true',
    customHostnamesEnabled: String(env.TRADING_CUSTOM_HOSTNAMES_ENABLED ?? '').toLowerCase() === 'true',
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mkety Trading V1</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#142033;background:#f6f8fb}
    *{box-sizing:border-box}body{margin:0}.shell{max-width:1240px;margin:0 auto;padding:24px}.top{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:18px}.brand h1{margin:0;font-size:24px}.brand p{margin:5px 0 0;color:#64748b;font-size:13px}.card{background:#fff;border:1px solid #dfe5ee;border-radius:14px;box-shadow:0 3px 16px rgba(15,23,42,.05)}.auth{padding:16px;display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end}.auth label,.field label{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}.auth input,.field input,.field select,.field textarea{width:100%;border:1px solid #cfd8e6;border-radius:9px;padding:10px;background:#fff;font:inherit;font-size:13px}.btn{border:0;border-radius:9px;padding:10px 13px;font-weight:700;cursor:pointer}.btn.primary{background:#0f172a;color:#fff}.btn.secondary{background:#eef2f7;color:#1e293b}.btn.warn{background:#fff7ed;color:#9a3412}.btn.danger{background:#fef2f2;color:#b91c1c}.btn.good{background:#ecfdf5;color:#047857}.tabs{display:flex;gap:8px;overflow:auto;padding:8px;margin:16px 0}.tab{white-space:nowrap;border:0;background:transparent;padding:9px 12px;border-radius:8px;font-weight:700;color:#64748b;cursor:pointer}.tab.active{background:#0f172a;color:#fff}.panel{padding:18px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.stat{padding:16px}.stat .k{font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase}.stat .v{font-size:26px;font-weight:800;margin-top:5px}.toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.toolbar h2{margin:0;font-size:18px}.muted{color:#64748b;font-size:12px}.notice{padding:12px 14px;border-radius:10px;margin-bottom:12px;font-size:13px}.notice.error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}.notice.ok{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}.notice.info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:13px}.table th,.table td{text-align:left;border-bottom:1px solid #e8edf4;padding:11px;vertical-align:top}.table th{font-size:11px;text-transform:uppercase;color:#64748b;background:#f8fafc}.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef2f7;font-size:11px;font-weight:700}.row-actions{display:flex;gap:6px;flex-wrap:wrap}.form{padding:16px;margin-bottom:14px;display:none}.form.open{display:block}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.field.full{grid-column:1/-1}.json{white-space:pre-wrap;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f172a;color:#e2e8f0;padding:14px;border-radius:10px;max-height:420px;overflow:auto}.empty{padding:28px;text-align:center;color:#64748b}.hidden{display:none!important}@media(max-width:760px){.auth,.grid,.form-grid{grid-template-columns:1fr}.shell{padding:12px}}
  </style>
</head>
<body>
<div class="shell">
  <div class="top">
    <div class="brand"><h1>Mkety Trading V1</h1><p>Production API control surface • workspace-scoped • fail-closed</p></div>
    <div id="runtime" class="muted"></div>
  </div>

  <div class="card auth">
    <div><label for="workspaceId">Workspace ID</label><input id="workspaceId" autocomplete="off" placeholder="Trading workspace UUID" /></div>
    <div><label for="bearer">Mkety Trading Bearer</label><input id="bearer" type="password" autocomplete="off" placeholder="Short-lived signed Mkety assertion" /></div>
    <button class="btn primary" id="connectBtn">Connect</button>
  </div>

  <div id="message"></div>

  <div class="card tabs" id="tabs">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="sources">Sources</button>
    <button class="tab" data-tab="accounts">Accounts & Risk</button>
    <button class="tab" data-tab="members">Users</button>
    <button class="tab" data-tab="operations">Operations</button>
    <button class="tab" data-tab="hostnames">Domains</button>
    <button class="tab" data-tab="settings">Settings</button>
  </div>

  <div class="card panel">
    <section id="view-overview"></section>
    <section id="view-sources" class="hidden"></section>
    <section id="view-accounts" class="hidden"></section>
    <section id="view-members" class="hidden"></section>
    <section id="view-operations" class="hidden"></section>
    <section id="view-hostnames" class="hidden"></section>
    <section id="view-settings" class="hidden"></section>
  </div>
</div>
<script>
(function(){
  'use strict';
  var runtime = ${JSON.stringify(runtime)};
  var state = { workspace:null, members:[], sources:[], accounts:[], hostnames:[], operations:null, activeTab:'overview' };
  var workspaceInput = document.getElementById('workspaceId');
  var bearerInput = document.getElementById('bearer');
  workspaceInput.value = localStorage.getItem('mketyTradingWorkspaceId') || '';
  bearerInput.value = sessionStorage.getItem('mketyTradingBearer') || '';
  document.getElementById('runtime').textContent = 'Access fuse: ' + (runtime.tradingAccessEnabled?'ON':'OFF') + ' • Broker fuse: ' + (runtime.brokerExecutionEnabled?'ON':'OFF') + ' • Custom domains: ' + (runtime.customHostnamesEnabled?'ON':'OFF');

  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function cfg(){return { workspaceId:workspaceInput.value.trim(), bearer:bearerInput.value.trim() };}
  function showMessage(text,type){document.getElementById('message').innerHTML = text ? '<div class="notice '+(type||'info')+'">'+esc(text)+'</div>' : '';}
  function parseJsonField(id){var raw=document.getElementById(id).value.trim();if(!raw)return {};try{return JSON.parse(raw);}catch(e){throw new Error('Invalid JSON in '+id);}}

  async function v1(path, options){
    options = options || {};
    var c = cfg();
    if(!c.workspaceId) throw new Error('Workspace ID is required');
    if(!c.bearer) throw new Error('Mkety Trading bearer is required');
    var headers = Object.assign({
      'Accept':'application/json',
      'Content-Type':'application/json',
      'X-Mkety-Workspace-Id':c.workspaceId,
      'Authorization':'Bearer '+c.bearer
    }, options.headers || {});
    var response = await fetch(path, Object.assign({}, options, { headers:headers }));
    var body = null;
    try{ body = await response.json(); }catch(e){ body = {ok:false,reason:'NON_JSON_RESPONSE'}; }
    if(!response.ok || !body || body.ok === false){
      var err = new Error((body && (body.reason || body.error)) || ('HTTP_'+response.status));
      err.status = response.status; err.body = body; throw err;
    }
    return body;
  }

  function persistSession(){
    var c=cfg();
    localStorage.setItem('mketyTradingWorkspaceId',c.workspaceId);
    sessionStorage.setItem('mketyTradingBearer',c.bearer);
  }

  async function refreshWorkspace(){ state.workspace = (await v1('/api/v1/admin/workspace')).workspace; }
  async function refreshMembers(){ state.members = (await v1('/api/v1/admin/members')).members || []; }
  async function refreshSources(){ state.sources = (await v1('/api/v1/admin/sources')).sources || []; }
  async function refreshAccounts(){ var r=await v1('/api/v1/admin/accounts'); state.accounts=r.accounts||[]; state.masterBrokerExecutionEnabled=!!r.masterBrokerExecutionEnabled; }
  async function refreshHostnames(){ state.hostnames = (await v1('/api/v1/admin/hostnames')).hostnames || []; }
  async function refreshOperations(){ state.operations = await v1('/api/v1/admin/operations'); }

  async function connect(){
    persistSession(); showMessage('Loading Trading workspace...','info');
    try{
      await Promise.all([refreshWorkspace(),refreshMembers(),refreshSources(),refreshAccounts(),refreshHostnames()]);
      try{await refreshOperations();}catch(e){state.operations={ok:false,reason:e.message};}
      showMessage('Connected to canonical Trading V1 API.','ok'); renderAll();
    }catch(e){showMessage('Connection failed: '+e.message,'error'); renderAll();}
  }

  function overview(){
    var w=state.workspace;
    if(!w)return '<div class="empty">Enter a workspace ID and Mkety bearer, then Connect.</div>';
    return '<div class="toolbar"><div><h2>'+esc(w.name||'Trading workspace')+'</h2><div class="muted">'+esc(w.id)+' • '+esc(w.owner_email||'')+'</div></div><span class="badge">Trading access '+(w.trading_access_enabled?'enabled':'disabled')+'</span></div>'+
      '<div class="grid">'+
      '<div class="card stat"><div class="k">Sources</div><div class="v">'+state.sources.length+'</div></div>'+
      '<div class="card stat"><div class="k">Broker accounts</div><div class="v">'+state.accounts.length+'</div></div>'+
      '<div class="card stat"><div class="k">Users</div><div class="v">'+state.members.length+'</div></div></div>'+
      '<div class="notice info" style="margin-top:14px">Frontend state is reloaded from V1 responses after every mutation. No direct Supabase table proxy is used.</div>';
  }

  function sourceRows(){
    if(!state.sources.length)return '<tr><td colspan="7" class="empty">No sources configured.</td></tr>';
    return state.sources.map(function(s){
      return '<tr><td>'+esc(s.displayName||s.sourceInstanceId||s.id)+'</td><td>'+esc(s.providerType)+'</td><td>'+esc(s.sourceFamily)+'</td><td><span class="badge">'+(s.enabled?'Enabled':'Disabled')+'</span></td><td>'+esc((s.health&&s.health.status)||'—')+'</td><td>'+esc(s.credentialConfigured?'Configured':'Not configured')+'</td><td class="row-actions"><button class="btn '+(s.enabled?'warn':'good')+'" data-action="source-state" data-id="'+esc(s.id)+'" data-enabled="'+(!s.enabled)+'">'+(s.enabled?'Disable':'Enable')+'</button></td></tr>';
    }).join('');
  }
  function sourcesView(){
    return '<div class="toolbar"><div><h2>Sources</h2><div class="muted">Telegram/MTProto, TradingView, MT5 source and cTrader source connections.</div></div><button class="btn primary" data-toggle="source-form">Add source</button></div>'+
      '<div id="source-form" class="card form"><div class="form-grid">'+
      '<div class="field"><label>Provider type</label><select id="sourceProvider"><option>cloudflare_container_mtproto</option><option>cloudflare_do_mtproto</option><option>external_mtproto</option><option>tradingview_webhook</option><option>custom_signed_api</option><option>mt5_source_bridge</option><option>ctrader_source</option></select></div>'+
      '<div class="field"><label>Source family</label><input id="sourceFamily" value="telegram" /></div>'+
      '<div class="field"><label>Source type</label><input id="sourceType" value="telegram" /></div>'+
      '<div class="field"><label>Source instance ID</label><input id="sourceInstance" placeholder="Unique source instance" /></div>'+
      '<div class="field"><label>Display name</label><input id="sourceName" placeholder="Primary Telegram Source" /></div>'+
      '<div class="field"><label>Priority</label><input id="sourcePriority" type="number" value="0" /></div>'+
      '<div class="field full"><label>Credentials JSON (omit for TradingView/custom signed API)</label><textarea id="sourceCredentials" rows="5" placeholder="{&quot;apiId&quot;:123,&quot;apiHash&quot;:&quot;...&quot;,&quot;sessionString&quot;:&quot;...&quot;}"></textarea></div>'+
      '<div class="field full"><button class="btn primary" data-action="create-source">Create disabled source</button></div></div></div>'+
      '<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Provider</th><th>Family</th><th>State</th><th>Health</th><th>Credentials</th><th>Actions</th></tr></thead><tbody>'+sourceRows()+'</tbody></table></div>';
  }

  function accountRows(){
    if(!state.accounts.length)return '<tr><td colspan="8" class="empty">No broker accounts configured.</td></tr>';
    return state.accounts.map(function(a){
      return '<tr><td>'+esc(a.label||a.id)+'</td><td>'+esc(a.platform)+'</td><td>'+esc(a.accountId)+'</td><td>'+esc(a.serverName||'—')+'</td><td><span class="badge">'+(a.active?'Active':'Inactive')+'</span></td><td><span class="badge">'+(a.executionEnabled?'Execution ON':'Execution OFF')+'</span></td><td><span class="badge">Kill '+(a.killSwitch?'ON':'OFF')+'</span></td><td class="row-actions">'+
      '<button class="btn secondary" data-action="account-active" data-id="'+esc(a.id)+'" data-enabled="'+(!a.active)+'">'+(a.active?'Deactivate':'Activate')+'</button>'+
      '<button class="btn '+(a.executionEnabled?'warn':'good')+'" data-action="account-execution" data-id="'+esc(a.id)+'" data-enabled="'+(!a.executionEnabled)+'">'+(a.executionEnabled?'Disable exec':'Enable exec')+'</button>'+
      '<button class="btn '+(a.killSwitch?'good':'danger')+'" data-action="account-kill" data-id="'+esc(a.id)+'" data-enabled="'+(!a.killSwitch)+'">'+(a.killSwitch?'Release kill':'Engage kill')+'</button></td></tr>';
    }).join('');
  }
  function accountsView(){
    return '<div class="toolbar"><div><h2>Broker accounts & risk</h2><div class="muted">Server-owned MT5/cTrader credentials, activation, execution and kill switch.</div></div><button class="btn primary" data-toggle="account-form">Add account</button></div>'+
      '<div class="notice '+(state.masterBrokerExecutionEnabled?'ok':'info')+'">Master broker execution fuse: '+(state.masterBrokerExecutionEnabled?'ENABLED':'DISABLED')+'. Account controls still persist safely; the master fuse remains final authority.</div>'+
      '<div id="account-form" class="card form"><div class="form-grid">'+
      '<div class="field"><label>Label</label><input id="accountLabel" /></div><div class="field"><label>Platform</label><select id="accountPlatform"><option value="mt5">MT5</option><option value="ctrader">cTrader</option></select></div>'+
      '<div class="field"><label>Account ID</label><input id="accountExternalId" /></div><div class="field"><label>Server name</label><input id="accountServer" /></div>'+
      '<div class="field"><label>Lot sizing</label><select id="lotSizing"><option value="fixed">fixed</option></select></div><div class="field"><label>Lot value</label><input id="lotValue" type="number" step="0.01" value="0.01" /></div>'+
      '<div class="field full"><label>Credentials JSON</label><textarea id="accountCredentials" rows="5" placeholder="Provider-specific demo/live credentials. Stored encrypted by server."></textarea></div>'+
      '<div class="field full"><button class="btn primary" data-action="create-account">Create safe inactive account</button></div></div></div>'+
      '<div class="table-wrap"><table class="table"><thead><tr><th>Label</th><th>Platform</th><th>Account</th><th>Server</th><th>Active</th><th>Execution</th><th>Kill switch</th><th>Actions</th></tr></thead><tbody>'+accountRows()+'</tbody></table></div>';
  }

  function memberRows(){
    if(!state.members.length)return '<tr><td colspan="4" class="empty">No Trading members found.</td></tr>';
    return state.members.map(function(m){return '<tr><td>'+esc(m.subject)+'</td><td>'+esc(m.role)+'</td><td><span class="badge">'+(m.enabled?'Enabled':'Disabled')+'</span></td><td class="row-actions"><button class="btn secondary" data-action="member-state" data-subject="'+encodeURIComponent(m.subject)+'" data-enabled="'+(!m.enabled)+'">'+(m.enabled?'Disable':'Enable')+'</button><button class="btn secondary" data-action="member-role" data-subject="'+encodeURIComponent(m.subject)+'">Change role</button></td></tr>';}).join('');
  }
  function membersView(){
    return '<div class="toolbar"><div><h2>Users / members</h2><div class="muted">Supabase membership remains final Trading authorization and revocation authority.</div></div><button class="btn primary" data-toggle="member-form">Add member</button></div>'+
      '<div id="member-form" class="card form"><div class="form-grid"><div class="field"><label>Mkety identity subject</label><input id="memberSubject" /></div><div class="field"><label>Role</label><select id="memberRole"><option>owner</option><option>admin</option><option>operator</option><option>viewer</option></select></div><div class="field full"><button class="btn primary" data-action="create-member">Add / update member</button></div></div></div>'+
      '<div class="table-wrap"><table class="table"><thead><tr><th>Subject</th><th>Role</th><th>State</th><th>Actions</th></tr></thead><tbody>'+memberRows()+'</tbody></table></div>';
  }

  function operationsView(){
    return '<div class="toolbar"><div><h2>Operations & event audit</h2><div class="muted">Operational state comes from the V1 operations endpoint.</div></div><div class="row-actions"><button class="btn secondary" data-action="refresh-operations">Refresh</button><button class="btn primary" data-action="audit-event">Audit event ID</button></div></div><pre class="json">'+esc(JSON.stringify(state.operations||{message:'No operations data loaded.'},null,2))+'</pre><div id="eventAudit"></div>';
  }

  function hostnameRows(){
    if(!state.hostnames.length)return '<tr><td colspan="4" class="empty">No custom domains configured.</td></tr>';
    return state.hostnames.map(function(h){return '<tr><td>'+esc(h.hostname)+'</td><td><span class="badge">'+esc(h.status)+'</span></td><td>'+esc(h.verifiedAt||'—')+'</td><td class="row-actions"><button class="btn secondary" data-action="verify-hostname" data-id="'+esc(h.id)+'">Verify</button></td></tr>';}).join('');
  }
  function hostnamesView(){
    return '<div class="toolbar"><div><h2>Domains</h2><div class="muted">Custom hostname routing is optional context only and never grants workspace authority.</div></div><button class="btn primary" data-toggle="hostname-form">Add hostname</button></div>'+
      '<div id="hostname-form" class="card form"><div class="form-grid"><div class="field"><label>Hostname</label><input id="hostnameValue" placeholder="trade.customer.com" /></div><div class="field"><label>&nbsp;</label><button class="btn primary" data-action="create-hostname">Create</button></div></div></div>'+
      '<div class="table-wrap"><table class="table"><thead><tr><th>Hostname</th><th>Status</th><th>Verified</th><th>Actions</th></tr></thead><tbody>'+hostnameRows()+'</tbody></table></div>';
  }

  function settingsView(){
    return '<div class="toolbar"><div><h2>Settings</h2><div class="muted">Only settings backed by V1 server contracts are editable.</div></div></div>'+
      '<div class="grid"><div class="card stat"><div class="k">Trading access fuse</div><div class="v">'+(runtime.tradingAccessEnabled?'ON':'OFF')+'</div></div><div class="card stat"><div class="k">Broker execution fuse</div><div class="v">'+(runtime.brokerExecutionEnabled?'ON':'OFF')+'</div></div><div class="card stat"><div class="k">Custom hostnames</div><div class="v">'+(runtime.customHostnamesEnabled?'ON':'OFF')+'</div></div></div>'+
      '<div class="notice info" style="margin-top:14px">Runtime secrets, Mkety issuer/audience/JWKS, master encryption key and provider credentials are deployment-managed and intentionally read-only here. There is no fake “Save Settings” success path.</div>';
  }

  function renderAll(){
    document.getElementById('view-overview').innerHTML=overview();
    document.getElementById('view-sources').innerHTML=sourcesView();
    document.getElementById('view-accounts').innerHTML=accountsView();
    document.getElementById('view-members').innerHTML=membersView();
    document.getElementById('view-operations').innerHTML=operationsView();
    document.getElementById('view-hostnames').innerHTML=hostnamesView();
    document.getElementById('view-settings').innerHTML=settingsView();
  }

  async function mutate(fn, success){
    showMessage('Applying change...','info');
    try{await fn();showMessage(success||'Saved.','ok');renderAll();}catch(e){showMessage('Action failed: '+e.message,'error');renderAll();}
  }

  document.getElementById('connectBtn').addEventListener('click',connect);
  document.getElementById('tabs').addEventListener('click',function(e){
    var tab=e.target.closest('[data-tab]');if(!tab)return;state.activeTab=tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x.dataset.tab===state.activeTab);});
    document.querySelectorAll('section[id^="view-"]').forEach(function(x){x.classList.toggle('hidden',x.id!=='view-'+state.activeTab);});
  });

  document.body.addEventListener('click',function(e){
    var toggle=e.target.closest('[data-toggle]');if(toggle){var f=document.getElementById(toggle.dataset.toggle);if(f)f.classList.toggle('open');return;}
    var b=e.target.closest('[data-action]');if(!b)return;
    var action=b.dataset.action;
    if(action==='create-member') return mutate(async function(){await v1('/api/v1/admin/members',{method:'POST',body:JSON.stringify({subject:document.getElementById('memberSubject').value.trim(),role:document.getElementById('memberRole').value})});await refreshMembers();},'Member saved.');
    if(action==='member-state') return mutate(async function(){await v1('/api/v1/admin/members/'+b.dataset.subject+'/'+(b.dataset.enabled==='true'?'enable':'disable'),{method:'POST',body:'{}'});await refreshMembers();},'Member state updated.');
    if(action==='member-role'){var role=prompt('New role: owner, admin, operator, viewer');if(!role)return;return mutate(async function(){await v1('/api/v1/admin/members/'+b.dataset.subject+'/role',{method:'POST',body:JSON.stringify({role:role})});await refreshMembers();},'Member role updated.');}
    if(action==='create-source') return mutate(async function(){var p={providerType:document.getElementById('sourceProvider').value,sourceFamily:document.getElementById('sourceFamily').value.trim(),sourceType:document.getElementById('sourceType').value.trim(),sourceInstanceId:document.getElementById('sourceInstance').value.trim(),displayName:document.getElementById('sourceName').value.trim(),priority:Number(document.getElementById('sourcePriority').value||0)};var raw=document.getElementById('sourceCredentials').value.trim();if(raw)p.credentials=JSON.parse(raw);await v1('/api/v1/admin/sources',{method:'POST',body:JSON.stringify(p)});await refreshSources();},'Source created disabled.');
    if(action==='source-state') return mutate(async function(){await v1('/api/v1/admin/sources/'+encodeURIComponent(b.dataset.id)+'/state',{method:'POST',body:JSON.stringify({enabled:b.dataset.enabled==='true'})});await refreshSources();},'Source state updated.');
    if(action==='create-account') return mutate(async function(){await v1('/api/v1/admin/accounts',{method:'POST',body:JSON.stringify({label:document.getElementById('accountLabel').value.trim(),platform:document.getElementById('accountPlatform').value,accountId:document.getElementById('accountExternalId').value.trim(),serverName:document.getElementById('accountServer').value.trim(),lotSizingType:document.getElementById('lotSizing').value,lotValue:Number(document.getElementById('lotValue').value),credentials:parseJsonField('accountCredentials')})});await refreshAccounts();},'Account created inactive with kill switch engaged.');
    if(action==='account-active') return mutate(async function(){await v1('/api/v1/admin/accounts/'+encodeURIComponent(b.dataset.id)+'/active',{method:'POST',body:JSON.stringify({enabled:b.dataset.enabled==='true'})});await refreshAccounts();},'Account activation updated.');
    if(action==='account-execution') return mutate(async function(){await v1('/api/v1/admin/accounts/'+encodeURIComponent(b.dataset.id)+'/execution',{method:'POST',body:JSON.stringify({enabled:b.dataset.enabled==='true'})});await refreshAccounts();},'Account execution flag updated.');
    if(action==='account-kill') return mutate(async function(){await v1('/api/v1/admin/accounts/'+encodeURIComponent(b.dataset.id)+'/kill-switch',{method:'POST',body:JSON.stringify({enabled:b.dataset.enabled==='true'})});await refreshAccounts();},'Kill switch updated.');
    if(action==='create-hostname') return mutate(async function(){await v1('/api/v1/admin/hostnames',{method:'POST',body:JSON.stringify({hostname:document.getElementById('hostnameValue').value.trim()})});await refreshHostnames();},'Hostname created.');
    if(action==='verify-hostname') return mutate(async function(){await v1('/api/v1/admin/hostnames/'+encodeURIComponent(b.dataset.id)+'/verify',{method:'POST',body:'{}'});await refreshHostnames();},'Hostname verification refreshed.');
    if(action==='refresh-operations') return mutate(async function(){await refreshOperations();},'Operations refreshed.');
    if(action==='audit-event'){var id=prompt('Canonical event ID');if(!id)return;return mutate(async function(){var data=await v1('/api/v1/admin/events/'+encodeURIComponent(id)+'/audit');document.getElementById('eventAudit').innerHTML='<pre class="json" style="margin-top:12px">'+esc(JSON.stringify(data,null,2))+'</pre>';},'Event audit loaded.');}
  });

  renderAll();
  if(workspaceInput.value && bearerInput.value) connect();
})();
</script>
</body>
</html>`;
}
