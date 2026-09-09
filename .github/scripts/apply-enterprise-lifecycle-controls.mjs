import fs from 'node:fs';

const path = 'cloudflare-v2/src/dashboard_enterprise_portal.js';
let text = fs.readFileSync(path, 'utf8');

function replaceRequired(oldText, newText, label) {
  if (!text.includes(oldText)) throw new Error(`missing ${label} anchor`);
  text = text.replace(oldText, newText);
}

if (!text.includes('data-source-enable')) {
  replaceRequired(
    '<thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Credential</th></tr></thead><tbody id="sourceRows"></tbody>',
    '<thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Credential</th><th>Actions</th></tr></thead><tbody id="sourceRows"></tbody>',
    'source table header',
  );
  replaceRequired(
    '<thead><tr><th>Label</th><th>Platform</th><th>Account</th><th>State</th><th>Safety</th></tr></thead><tbody id="accountRows"></tbody>',
    '<thead><tr><th>Label</th><th>Platform</th><th>Account</th><th>State</th><th>Safety</th><th>Actions</th></tr></thead><tbody id="accountRows"></tbody>',
    'account table header',
  );

  text = text.replace(
    /document\.getElementById\('sourceRows'\)\.innerHTML=.*?;document\.getElementById\('accountRows'\)\.innerHTML=/,
    `document.getElementById('sourceRows').innerHTML=state.sources.length?state.sources.map(function(x){var actions='<div class="actions">'+(x.enabled?'<button class="btn secondary" data-source-disable="'+esc(x.id)+'">Disable</button>':'<button class="btn primary" data-source-enable="'+esc(x.id)+'">Enable</button>')+(x.isDefault?'<span class="pill good">Default</span>':'<button class="btn secondary" data-source-default="'+esc(x.id)+'">Set default</button>')+'</div>';return'<tr><td>'+esc(x.displayName||x.sourceInstanceId)+'</td><td>'+esc(x.providerType)+'</td><td>'+esc((x.health&&x.health.status)||(x.enabled?'Enabled':'Disabled'))+'</td><td>'+esc(x.credentialConfigured?'Configured':'Not required / not set')+'</td><td>'+actions+'</td></tr>'}).join(''):'<tr><td colspan="5" class="empty">No sources yet.</td></tr>';document.getElementById('accountRows').innerHTML=`,
  );
  text = text.replace(
    /document\.getElementById\('accountRows'\)\.innerHTML=.*?;document\.getElementById\('destinationList'\)\.innerHTML=/,
    `document.getElementById('accountRows').innerHTML=state.accounts.length?state.accounts.map(function(x){var actions='<div class="actions"><button class="btn secondary" data-account-active="'+esc(x.id)+'" data-enabled="'+(!x.active)+'">'+(x.active?'Deactivate':'Activate')+'</button><button class="btn '+(x.killSwitch?'good':'danger')+'" data-account-kill-switch="'+esc(x.id)+'" data-enabled="'+(!x.killSwitch)+'">'+(x.killSwitch?'Release kill switch':'Engage kill switch')+'</button></div>';return'<tr><td>'+esc(x.label)+'</td><td>'+esc(x.platform)+'</td><td>'+esc(x.accountId)+'</td><td>'+esc(x.active?'Active':'Safe / inactive')+'</td><td>'+esc(x.killSwitch?'Kill switch ON':'Kill switch OFF')+'</td><td>'+actions+'</td></tr>'}).join(''):'<tr><td colspan="6" class="empty">No broker connections yet.</td></tr>';document.getElementById('destinationList').innerHTML=`,
  );
  text = text.replace(
    /document\.getElementById\('destinationList'\)\.innerHTML=listCards\(state\.destinations,function\(x\)\{return.*?\},'No destinations yet\.'\);/,
    `document.getElementById('destinationList').innerHTML=listCards(state.destinations,function(x){return'<div class="formbox"><b>'+esc(x.displayName)+'</b> <span class="pill">'+esc(x.destinationType)+'</span><div class="muted small">'+esc(x.destinationRef||'Audit only')+' • '+(x.enabled?'Enabled':'Disabled')+'</div><div class="actions"><button class="btn secondary" data-destination-toggle="'+esc(x.id)+'" data-enabled="'+(!x.enabled)+'">'+(x.enabled?'Disable':'Enable')+'</button></div></div>'},'No destinations yet.');`,
  );
  text = text.replace(
    /document\.getElementById\('routeList'\)\.innerHTML=listCards\(state\.routes,function\(x\)\{return.*?\},'No routes yet\.'\);/,
    `document.getElementById('routeList').innerHTML=listCards(state.routes,function(x){return'<div class="formbox"><b>'+esc(x.routeName||'Route')+'</b><div class="muted small">'+esc(x.sourceConnectionId)+' → '+esc(x.destinationId)+' • '+(x.enabled?'Enabled':'Disabled')+'</div><div class="actions"><button class="btn secondary" data-route-toggle="'+esc(x.id)+'" data-enabled="'+(!x.enabled)+'">'+(x.enabled?'Disable':'Enable')+'</button></div></div>'},'No routes yet.');`,
  );

  replaceRequired(
    '<section id="view-team" class="view"><div class="card"><h2>Team access</h2><div class="muted small">Workspace members and roles.</div><div id="memberList"></div></div></section>',
    '<section id="view-team" class="view"><div class="card" data-team-central-auth-required="true"><h2>Team access</h2><div class="notice info">Team access requires central authentication before additional members can sign in. The current access-code workspace owner remains fully usable.</div><div id="memberList"></div></div></section>',
    'team section',
  );

  const functionAnchor = 'function showWorkspace(){';
  const helpers = `var lifecycleRoutes={sourceEnable:'/api/v1/admin/sources/:id/enable',sourceDisable:'/api/v1/admin/sources/:id/disable',sourceDefault:'/api/v1/admin/sources/:id/default',accountActive:'/api/v1/admin/accounts/:id/active',accountKillSwitch:'/api/v1/admin/accounts/:id/kill-switch',destinationEnable:'/api/v1/admin/destinations/:id/enable',destinationDisable:'/api/v1/admin/destinations/:id/disable',routeEnable:'/api/v1/admin/routes/:id/enable',routeDisable:'/api/v1/admin/routes/:id/disable'};\nfunction lifecyclePath(template,id){return template.replace(':id',encodeURIComponent(id))}\nasync function sourceLifecycle(id,action){var source=state.sources.find(function(x){return String(x.id)===String(id)});var route=action==='enable'?lifecycleRoutes.sourceEnable:action==='disable'?lifecycleRoutes.sourceDisable:lifecycleRoutes.sourceDefault;var body=action==='default'?JSON.stringify({sourceFamily:source&&source.sourceFamily||''}):'{}';await api(lifecyclePath(route,id),{method:'POST',body:body});await loadAll()}\nasync function accountLifecycle(id,action,enabled){var route=action==='active'?lifecycleRoutes.accountActive:lifecycleRoutes.accountKillSwitch;await api(lifecyclePath(route,id),{method:'POST',body:JSON.stringify({enabled:enabled})});await loadAll()}\nasync function destinationLifecycle(id,enabled){await api(lifecyclePath(enabled?lifecycleRoutes.destinationEnable:lifecycleRoutes.destinationDisable,id),{method:'POST',body:'{}'});await loadAll()}\nasync function routeLifecycle(id,enabled){await api(lifecyclePath(enabled?lifecycleRoutes.routeEnable:lifecycleRoutes.routeDisable,id),{method:'POST',body:'{}'});await loadAll()}\n`;
  replaceRequired(functionAnchor, helpers + functionAnchor, 'showWorkspace function');

  const finalAnchor = '});renderSourceFields();renderAccountFields();renderDestinationFields();showWorkspace();';
  const lifecycleListener = `});document.addEventListener('click',async function(ev){var t=ev.target;if(!t||!t.dataset)return;try{if(t.dataset.sourceEnable){await sourceLifecycle(t.dataset.sourceEnable,'enable');return}if(t.dataset.sourceDisable){await sourceLifecycle(t.dataset.sourceDisable,'disable');return}if(t.dataset.sourceDefault){await sourceLifecycle(t.dataset.sourceDefault,'default');return}if(t.dataset.accountActive){await accountLifecycle(t.dataset.accountActive,'active',t.dataset.enabled==='true');return}if(t.dataset.accountKillSwitch){await accountLifecycle(t.dataset.accountKillSwitch,'kill-switch',t.dataset.enabled==='true');return}if(t.dataset.destinationToggle){await destinationLifecycle(t.dataset.destinationToggle,t.dataset.enabled==='true');return}if(t.dataset.routeToggle){await routeLifecycle(t.dataset.routeToggle,t.dataset.enabled==='true');return}}catch(e){msg('workspaceMessage','Update failed: '+friendlyError(e),'error')}});renderSourceFields();renderAccountFields();renderDestinationFields();showWorkspace();`;
  replaceRequired(finalAnchor, lifecycleListener, 'final event listener');
}

fs.writeFileSync(path, text);
console.log('enterprise lifecycle controls patched');
