function accessRowTimestamp(row = {}) {
  const raw = row.updatedAt ?? row.createdAt ?? row.lastRedeemedAt ?? row.expiresAt ?? null;
  const parsed = Date.parse(String(raw ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function accessRowRank(row = {}) {
  return String(row.status ?? '').trim().toLowerCase() === 'active' ? 2 : 1;
}

export function collapseMketyWorkspaceAccessRows(codes = []) {
  const map = new Map();
  for (const code of Array.isArray(codes) ? codes : []) {
    const key = String(code?.workspaceId ?? code?.id ?? '').trim();
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...code, historyCount: 1 });
      continue;
    }

    const historyCount = Number(existing.historyCount || 1) + 1;
    const candidateWins = accessRowRank(code) > accessRowRank(existing)
      || (accessRowRank(code) === accessRowRank(existing) && accessRowTimestamp(code) > accessRowTimestamp(existing));
    if (candidateWins) map.set(key, { ...code, historyCount });
    else existing.historyCount = historyCount;
  }
  return [...map.values()];
}

export function renderMketyAdminAccessCodesPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mkety Staff Trading Admin</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#eef4ff;background:#07111f}
    body{margin:0;background:#07111f;color:#eef4ff}.wrap{max-width:1120px;margin:0 auto;padding:32px 20px 64px}h1{margin:0 0 8px;font-size:32px}h2{margin:0 0 8px}.muted{color:#9fb2cc}.small{font-size:12px}.card{background:#0c1a2c;border:1px solid #203a59;border-radius:16px;padding:20px;margin-top:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.field{display:flex;flex-direction:column;gap:6px}label{font-size:13px;color:#b9c9dd}input{background:#081522;color:#eef4ff;border:1px solid #2b496b;border-radius:10px;padding:10px 12px}button{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#38a3ff;color:#04101c}.secondary{background:#17304b;color:#eef4ff}.danger{background:#8f3141;color:white}.success{background:#1c7d53;color:white}.checks{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}.checks label{display:flex;align-items:center;gap:7px;background:#0a1727;border:1px solid #203a59;border-radius:10px;padding:9px 11px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{text-align:left;padding:11px 9px;border-bottom:1px solid #203a59;vertical-align:top}th{font-size:12px;color:#9fb2cc;text-transform:uppercase}.once{margin-top:14px;padding:13px;border-radius:10px;background:#0d2b20;border:1px solid #27694e;display:none;word-break:break-all}.error{color:#ff9ca8;margin-top:10px}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.status{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.pill{padding:7px 10px;border-radius:999px;background:#15283e;border:1px solid #294765;font-size:13px}.warning{padding:12px;border-radius:10px;background:#2c2410;border:1px solid #725a1e;color:#ffe5a6}.okbox{padding:12px;border-radius:10px;background:#0d2b20;border:1px solid #27694e;color:#b9f4d6}.control-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:16px}.control{background:#081522;border:1px solid #203a59;border-radius:14px;padding:16px}.control h3{margin:0 0 6px}.state{font-weight:800;margin-top:10px}.state-on{color:#8ef0bd}.state-off{color:#ffb2bb}
  </style>
</head>
<body><main class="wrap">
  <h1>Mkety Staff Trading Admin</h1>
  <p class="muted">Manage one persistent Trading workspace per customer, its subscription access, and global runtime safety controls. Reissue changes the access code, not the workspace.</p>

  <section class="card"><div class="field"><label for="staffSecret">Mkety Trading admin secret (memory only)</label><input id="staffSecret" type="password" autocomplete="off" placeholder="Enter MKETY_TRADING_ADMIN_SECRET" /></div><div class="toolbar"><button class="secondary" id="refreshBtn" type="button">Refresh admin state</button></div><div id="pageError" class="error" role="alert"></div></section>

  <section class="card"><h2>Global runtime controls</h2><p class="muted">Platform-wide safety switches. LIVE should remain OFF during DEMO acceptance.</p><div class="control-grid">
    <div class="control"><h3>Trading system</h3><div id="tradingSystemStatus" class="state">State: unknown</div><div class="toolbar"><button class="danger" id="disableTradingBtn">Turn trading system OFF</button><button class="success" id="enableTradingBtn">Turn trading system ON</button></div></div>
    <div class="control"><h3>Broker execution</h3><div id="brokerStatus" class="state">State: unknown</div><div class="toolbar"><button class="danger" id="disableBrokerBtn">Turn broker execution OFF</button><button class="success" id="enableBrokerBtn">Turn broker execution ON</button></div></div>
    <div class="control"><h3>Live broker execution</h3><div id="liveBrokerStatus" class="state">State: unknown</div><div class="toolbar"><button class="danger" id="disableLiveBtn">Turn live execution OFF</button><button class="success" id="enableLiveBtn">Turn live execution ON</button></div></div>
  </div><div class="status"><span class="pill" id="effectiveStatus">Effective broker execution: unknown</span><span class="pill" id="effectiveLiveStatus">Effective live execution: unknown</span></div><div id="brokerSafetyMessage" class="warning">Enter the admin secret and refresh before changing controls.</div></section>

  <section class="card"><h2>Create or reissue / rotate access code</h2><p class="muted">Leave Existing workspace ID blank only for a new customer. Reissue / Rotate access keeps the same workspace, accounts, sources, routes, destinations and settings, while it invalidates prior active access codes.</p><div class="grid">
    <div class="field"><label for="ownerEmail">Owner email</label><input id="ownerEmail" type="email" /></div><div class="field"><label for="ownerName">Owner name</label><input id="ownerName" /></div><div class="field"><label for="workspaceName">Workspace name</label><input id="workspaceName" /></div><div class="field"><label for="workspaceId">Existing workspace ID (optional)</label><input id="workspaceId" placeholder="Same workspace for reissue / renewal" /></div><div class="field"><label for="expiresAt">Subscription/code expires at</label><input id="expiresAt" type="datetime-local" /></div>
  </div><div class="checks"><label><input id="tradingExecutionDestination" type="checkbox" checked /> Trading execution destination</label><label><input id="telegramDestination" type="checkbox" /> Telegram destination</label><label><input id="customSubdomain" type="checkbox" /> Custom subdomain</label><label><input id="customHostname" type="checkbox" /> Custom hostname</label></div><div class="toolbar"><button class="secondary preset" data-preset="trading">Trading Only</button><button class="secondary preset" data-preset="tradingTelegram">Trading + Telegram</button><button class="secondary preset" data-preset="full">Full Access</button><button id="createBtn">Create access code</button></div><div id="plainCode" class="once"></div></section>

  <section class="card"><h2>Customer workspaces & subscription access</h2><p class="muted">One row per workspace. Revoked/old codes remain audit history but no longer appear as duplicate customer workspaces. Revoke locks the workspace. Reissue / Rotate access renews the subscription on the same workspace and restores access.</p><table><thead><tr><th>Workspace</th><th>Owner</th><th>Access</th><th>Entitlements</th><th>Expires</th><th>Action</th></tr></thead><tbody id="rows"><tr><td colspan="6" class="muted">Enter the staff secret and refresh.</td></tr></tbody></table></section>
</main>
<script>(()=>{
const API='/api/v1/mkety-admin/access-codes',RUNTIME_API='/api/v1/mkety-admin/runtime-controls',$=(id)=>document.getElementById(id),esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let accessRows=[];
const headers=(json=false)=>{const h={'X-Mkety-Admin-Secret':$('staffSecret').value};if(json)h['Content-Type']='application/json';return h};const err=(m='')=>{$('pageError').textContent=m};
async function request(path,options={}){const r=await fetch(path,options);let b={};try{b=await r.json()}catch{}if(!r.ok||!b.ok)throw new Error(b.reason||('HTTP '+r.status));return b}
function summary(e={}){const a=[];if(e.tradingExecutionDestination)a.push('Trading execution');if(e.telegramDestination||(Array.isArray(e.destinations)&&e.destinations.includes('telegram')))a.push('Telegram');if(e.customSubdomain)a.push('Subdomain');if(e.customHostname)a.push('Hostname');return a.length?a.join(', '):'Restricted'}
function effectiveStatus(x){if(x.status==='active'&&x.expiresAt&&new Date(x.expiresAt).getTime()<=Date.now())return'expired';return x.status||'unknown'}
function rowTime(x){const t=Date.parse(String(x.updatedAt||x.createdAt||x.lastRedeemedAt||x.expiresAt||''));return Number.isFinite(t)?t:0}function rowRank(x){return String(x.status||'').toLowerCase()==='active'?2:1}function collapseWorkspaces(codes){const map=new Map();for(const code of codes){const key=String(code.workspaceId||code.id||'').trim();if(!key)continue;const current=map.get(key);if(!current){map.set(key,{...code,historyCount:1});continue}const count=Number(current.historyCount||1)+1;const wins=rowRank(code)>rowRank(current)||(rowRank(code)===rowRank(current)&&rowTime(code)>rowTime(current));if(wins)map.set(key,{...code,historyCount:count});else current.historyCount=count}return[...map.values()]}
function state(id,on){const n=$(id);n.textContent='State: '+(on?'ON':'OFF');n.className='state '+(on?'state-on':'state-off')}
function renderRuntime(b){const t=b.tradingAccessEnabled===true,x=b.brokerExecutionEnabled===true,l=b.liveBrokerExecutionEnabled===true,e=b.effectiveBrokerExecutionEnabled===true,el=b.effectiveLiveBrokerExecutionEnabled===true;state('tradingSystemStatus',t);state('brokerStatus',x);state('liveBrokerStatus',l);$('effectiveStatus').textContent='Effective broker execution: '+(e?'ON':'BLOCKED');$('effectiveLiveStatus').textContent='Effective live execution: '+(el?'ON':'BLOCKED');$('brokerSafetyMessage').className=el?'warning':'okbox';$('brokerSafetyMessage').textContent=el?'LIVE MONEY EXECUTION IS ENABLED. Disable it unless explicitly approved for production.':!t?'Trading system is OFF.':!x?'Trading system is ON, but broker execution is globally blocked.':l?'Broker execution and LIVE are ON.':'Demo-ready posture: broker execution can run while LIVE remains OFF.'}
async function refreshRuntime(){renderRuntime(await request(RUNTIME_API,{headers:headers()}))}
async function setRuntime(field,next,msg){err();if(msg&&!confirm(msg))return;try{const p={};p[field]=next;renderRuntime(await request(RUNTIME_API,{method:'PATCH',headers:headers(true),body:JSON.stringify(p)}))}catch(e){err(e.message)}}
async function refreshCodes(){const body=await request(API,{headers:headers()});accessRows=collapseWorkspaces(body.accessCodes||[]);$('rows').innerHTML=accessRows.length?accessRows.map((x)=>{const st=effectiveStatus(x),history=x.historyCount>1?'<div class="muted small">'+esc(x.historyCount)+' access-code records; older codes are history only</div>':'';return'<tr><td><b>'+esc(x.workspaceDisplayName||x.workspaceId)+'</b><div class="muted small">'+esc(x.workspaceId||'')+'</div>'+history+'</td><td>'+esc(x.ownerEmail||'')+'</td><td><b>'+esc(st)+'</b></td><td>'+esc(summary(x.entitlements))+'</td><td>'+esc(x.expiresAt||'')+'</td><td><div class="toolbar"><button class="secondary reissue" data-id="'+esc(x.id)+'">Reissue / Rotate access</button>'+(st==='active'?'<button class="danger revoke" data-id="'+esc(x.id)+'">Revoke workspace access</button>':'')+'</div></td></tr>'}).join(''):'<tr><td colspan="6" class="muted">No customer workspaces.</td></tr>'}
async function refresh(){err();try{await Promise.all([refreshCodes(),refreshRuntime()])}catch(e){err(e.message)}}
function preset(n){const f=n==='full';$('tradingExecutionDestination').checked=true;$('telegramDestination').checked=n==='tradingTelegram'||f;$('customSubdomain').checked=f;$('customHostname').checked=f}
function applyEntitlements(e={}){$('tradingExecutionDestination').checked=e.tradingExecutionDestination===true;$('telegramDestination').checked=e.telegramDestination===true||(Array.isArray(e.destinations)&&e.destinations.includes('telegram'));$('customSubdomain').checked=e.customSubdomain===true;$('customHostname').checked=e.customHostname===true}
function prepare(id){const x=accessRows.find((r)=>String(r.id)===String(id));if(!x)return;$('ownerEmail').value=x.ownerEmail||'';$('ownerName').value=x.ownerName||'';$('workspaceName').value=x.workspaceDisplayName||'';$('workspaceId').value=x.workspaceId||'';$('expiresAt').value='';$('createBtn').textContent='Reissue / Rotate access';applyEntitlements(x.entitlements||{});$('plainCode').style.display='none';window.scrollTo({top:$('ownerEmail').getBoundingClientRect().top+window.scrollY-80,behavior:'smooth'})}
async function createCode(){err();$('plainCode').style.display='none';const exp=$('expiresAt').value,p={ownerEmail:$('ownerEmail').value,ownerName:$('ownerName').value,workspaceName:$('workspaceName').value,workspaceId:$('workspaceId').value.trim()||undefined,expiresAt:exp?new Date(exp).toISOString():undefined,entitlements:{tradingExecutionDestination:$('tradingExecutionDestination').checked,telegramDestination:$('telegramDestination').checked,customSubdomain:$('customSubdomain').checked,customHostname:$('customHostname').checked,destinations:[...($('tradingExecutionDestination').checked?['broker_account']:[]),...($('telegramDestination').checked?['telegram']:[]),'audit_only'],sourceTypes:['telegram','tradingview'],brokerModes:['demo'],liveExecution:false,maxTeamMembers:1}};if(p.workspaceId&&!confirm('Renew/reissue access for this SAME workspace? Its existing configuration remains intact and prior active codes stop working.'))return;try{const b=await request(API,{method:'POST',headers:headers(true),body:JSON.stringify(p)});$('plainCode').textContent='Shown once — copy now: '+b.accessCode.plainCode;$('plainCode').style.display='block';await refreshCodes()}catch(e){err(e.message)}}
document.querySelectorAll('.preset').forEach((b)=>b.addEventListener('click',()=>preset(b.dataset.preset)));$('refreshBtn').addEventListener('click',refresh);$('createBtn').addEventListener('click',createCode);$('disableTradingBtn').addEventListener('click',()=>setRuntime('tradingAccessEnabled',false,'Turn the entire V1 trading system OFF?'));$('enableTradingBtn').addEventListener('click',()=>setRuntime('tradingAccessEnabled',true,'Turn the V1 trading system ON?'));$('disableBrokerBtn').addEventListener('click',()=>setRuntime('brokerExecutionEnabled',false,'Turn all broker execution OFF?'));$('enableBrokerBtn').addEventListener('click',()=>setRuntime('brokerExecutionEnabled',true,'Enable broker execution? Other safety gates still apply.'));$('disableLiveBtn').addEventListener('click',()=>setRuntime('liveBrokerExecutionEnabled',false,'Turn real-money broker execution OFF?'));$('enableLiveBtn').addEventListener('click',()=>setRuntime('liveBrokerExecutionEnabled',true,'HIGH RISK: enable platform-wide real-money execution?'));
$('rows').addEventListener('click',async(e)=>{const r=e.target.closest('.reissue');if(r){prepare(r.dataset.id);return}const b=e.target.closest('.revoke');if(!b)return;if(!confirm('Revoke this workspace subscription now? The workspace and all configuration stay intact, but the customer loses access until Mkety reissues/renews it.'))return;err();try{await request(API+'/'+encodeURIComponent(b.dataset.id)+'/revoke',{method:'POST',headers:headers()});await refreshCodes()}catch(x){err(x.message)}})
})();</script></body></html>`;
}
