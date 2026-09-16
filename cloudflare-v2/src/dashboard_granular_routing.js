export function withGranularRoutingConsole(html) {
  const marker = '</body>';
  if (!String(html).includes(marker)) return String(html);
  const panel = `<section id="granularRoutingPanel" class="card" style="margin-top:18px">
  <h3>Granular source routing</h3>
  <p class="muted small">One Telegram connection can contain many independently routable chats. Use <b>All feeds / default</b> only when every chat on that connection should share the same destinations.</p>
  <div class="grid">
    <div class="formbox">
      <b>Route one source feed</b>
      <div class="field"><label>Source / feed</label><select id="granularRouteSource"><option value="">Loading sources…</option></select></div>
      <div class="field"><label>Destination</label><select id="granularRouteDestination"><option value="">Loading destinations…</option></select></div>
      <div class="field"><label>Route name</label><input id="granularRouteName" placeholder="Gold → Octa MT5"></div>
      <div class="grid">
        <div class="field"><label>Allowed canonical symbols (optional)</label><input id="granularAllowedSymbols" placeholder="XAUUSD, EURUSD"></div>
        <div class="field"><label>Blocked canonical symbols (optional)</label><input id="granularBlockedSymbols" placeholder="DERIV:VOLATILITY_75"></div>
      </div>
      <button id="granularCreateRoute" class="btn primary" type="button">Create selective route</button>
      <div id="granularRouteMessage" class="muted small" style="margin-top:7px"></div>
    </div>
    <div class="formbox">
      <b>Reusable Telegram delivery bot</b>
      <div class="muted small">Save a BotFather token once, then reuse it for any number of destination channels where that bot is an admin.</div>
      <div class="field"><label>Bot connection name</label><input id="granularBotName" placeholder="Starpips delivery bot"></div>
      <div class="field"><label>Bot token</label><input id="granularBotToken" type="password" autocomplete="new-password" placeholder="123456:ABC..."></div>
      <button id="granularCreateBot" class="btn secondary" type="button">Save bot credential</button>
      <hr style="margin:14px 0">
      <div class="field"><label>Saved bot</label><select id="granularBotConnection"><option value="">No saved bot yet</option></select></div>
      <div class="field"><label>Destination channel name</label><input id="granularTelegramDestinationName" placeholder="VIP Gold"></div>
      <div class="field"><label>Destination chat/channel ID</label><input id="granularTelegramDestinationChat" placeholder="-1001234567890"></div>
      <div class="field"><label>Formatting template (optional)</label><select id="granularTelegramTemplate"><option value="">No template / existing default</option></select></div>
      <button id="granularCreateTelegramDestination" class="btn secondary" type="button">Add Telegram channel endpoint</button>
      <div id="granularBotMessage" class="muted small" style="margin-top:7px"></div>
    </div>
  </div>
  <div class="formbox" style="margin-top:12px"><b>Source feeds</b><div id="granularFeedSummary" class="muted small">Loading…</div></div>
</section>`;
  const script = `<script>(function(){'use strict';
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
function auth(){return{workspace:sessionStorage.getItem('mketyTradingWorkspace')||'',bearer:sessionStorage.getItem('mketyTradingBearer')||''}}
async function admin(path,options){options=options||{};var a=auth();if(!a.workspace||!a.bearer)throw new Error('Your session has expired. Sign in again.');var r=await fetch(path,Object.assign({},options,{headers:Object.assign({'Accept':'application/json','Content-Type':'application/json','X-Mkety-Workspace-Id':a.workspace,'Authorization':'Bearer '+a.bearer},options.headers||{})}));var b;try{b=await r.json()}catch(_){b={ok:false,reason:'NON_JSON_RESPONSE'}}if(!r.ok||b.ok===false)throw new Error(b.reason||('HTTP_'+r.status));return b}
function ids(v){return Array.from(new Set(String(v||'').split(/[\\n,]+/).map(function(x){return x.trim().toUpperCase()}).filter(Boolean)))}
function msg(id,text,ok){var el=q(id);if(!el)return;el.textContent=text;el.className=(ok?'notice success':'notice error')+' small'}
function pack(sourceId,feedId){return encodeURIComponent(sourceId)+'|'+encodeURIComponent(feedId||'')}
function unpack(value){var parts=String(value||'').split('|');return{sourceId:decodeURIComponent(parts[0]||''),feedId:decodeURIComponent(parts[1]||'')||null}}
async function load(){var jobs=await Promise.allSettled([admin('/api/v1/admin/sources'),admin('/api/v1/admin/destinations'),admin('/api/v1/admin/destination-connections'),admin('/api/v1/admin/templates')]);var sources=jobs[0].status==='fulfilled'?(jobs[0].value.sources||[]):[],destinations=jobs[1].status==='fulfilled'?(jobs[1].value.destinations||[]):[],connections=jobs[2].status==='fulfilled'?(jobs[2].value.destinationConnections||[]):[],templates=jobs[3].status==='fulfilled'?(jobs[3].value.templates||[]):[];var feedRows=await Promise.all(sources.map(async function(s){try{var r=await admin('/api/v1/admin/sources/'+encodeURIComponent(s.id)+'/feeds');return{s:s,feeds:r.feeds||[]}}catch(_){return{s:s,feeds:[]}}}));renderSources(feedRows);renderDestinations(destinations);renderBots(connections);renderTemplates(templates);renderSummary(feedRows)}
function renderSources(rows){var el=q('granularRouteSource');if(!el)return;var options=['<option value="">Select source/feed</option>'];rows.forEach(function(row){var name=row.s.displayName||row.s.sourceInstanceId||row.s.id;options.push('<option value="'+esc(pack(row.s.id,''))+'">'+esc(name)+' — All feeds / default</option>');row.feeds.forEach(function(f){options.push('<option value="'+esc(pack(row.s.id,f.id))+'">'+esc(name)+' → '+esc(f.displayName||f.providerFeedId)+'</option>')})});el.innerHTML=options.join('')}
function renderDestinations(rows){var el=q('granularRouteDestination');if(!el)return;el.innerHTML='<option value="">Select destination</option>'+rows.map(function(d){return '<option value="'+esc(d.id)+'">'+esc(d.displayName)+' • '+esc(d.destinationType)+(d.enabled?'':' • disabled')+'</option>'}).join('')}
function renderBots(rows){var el=q('granularBotConnection');if(!el)return;var active=rows.filter(function(x){return x.enabled&&x.providerType==='telegram_bot_api'});el.innerHTML='<option value="">Select saved bot</option>'+active.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.displayName)+'</option>'}).join('')}
function renderTemplates(rows){var el=q('granularTelegramTemplate');if(!el)return;el.innerHTML='<option value="">No template / existing default</option>'+rows.map(function(t){return '<option value="'+esc(t.id)+'">'+esc(t.templateName)+'</option>'}).join('')}
function renderSummary(rows){var el=q('granularFeedSummary');if(!el)return;if(!rows.length){el.innerHTML='No source connections yet.';return}el.innerHTML=rows.map(function(row){var name=row.s.displayName||row.s.sourceInstanceId||row.s.id;if(!row.feeds.length)return '<div style="padding:5px 0"><b>'+esc(name)+'</b> — no materialized child feeds; existing connection-level routes remain active.</div>';return '<div style="padding:5px 0"><b>'+esc(name)+'</b>: '+row.feeds.map(function(f){return '<span class="pill">'+esc(f.displayName||f.providerFeedId)+'</span>'}).join(' ')+'</div>'}).join('')}
async function createRoute(){var src=unpack(q('granularRouteSource').value),destinationId=q('granularRouteDestination').value,name=q('granularRouteName').value.trim();if(!src.sourceId||!destinationId){msg('granularRouteMessage','Choose a source/feed and destination.',false);return}var filters={},allowed=ids(q('granularAllowedSymbols').value),blocked=ids(q('granularBlockedSymbols').value);if(allowed.length)filters.allowedCanonicalSymbols=allowed;if(blocked.length)filters.blockedCanonicalSymbols=blocked;var payload={sourceConnectionId:src.sourceId,sourceFeedId:src.feedId,destinationId:destinationId,routeName:name||null,filters:filters};try{await admin('/api/v1/admin/routes',{method:'POST',body:JSON.stringify(payload)});msg('granularRouteMessage',src.feedId?'Selective feed route saved.':'Default/all-feeds route saved.',true);await load()}catch(e){msg('granularRouteMessage','Route failed: '+String(e.message||e),false)}}
async function createBot(){var name=q('granularBotName').value.trim(),token=q('granularBotToken').value.trim();if(!name||!token){msg('granularBotMessage','Bot name and token are required.',false);return}try{await admin('/api/v1/admin/destination-connections',{method:'POST',body:JSON.stringify({providerType:'telegram_bot_api',displayName:name,credentials:{botToken:token}})});q('granularBotToken').value='';msg('granularBotMessage','Bot credential saved encrypted. Add one or more channel endpoints below.',true);await load()}catch(e){msg('granularBotMessage','Bot credential failed: '+String(e.message||e),false)}}
async function createTelegramDestination(){var credentialConnectionId=q('granularBotConnection').value,name=q('granularTelegramDestinationName').value.trim(),chat=q('granularTelegramDestinationChat').value.trim(),templateId=q('granularTelegramTemplate').value||null;if(!credentialConnectionId||!name||!chat){msg('granularBotMessage','Choose a saved bot and enter a destination name and chat/channel ID.',false);return}try{await admin('/api/v1/admin/destinations',{method:'POST',body:JSON.stringify({destinationType:'telegram',displayName:name,destinationRef:chat,templateId:templateId,credentialConnectionId:credentialConnectionId,settings:{}})});msg('granularBotMessage','Telegram channel endpoint saved. Enable it in Destination controls when ready.',true);q('granularTelegramDestinationName').value='';q('granularTelegramDestinationChat').value='';await load()}catch(e){msg('granularBotMessage','Telegram endpoint failed: '+String(e.message||e),false)}}
function install(){var panel=q('granularRoutingPanel');if(panel){var routeCard=q('routeList')&&q('routeList').closest('.card');var target=document.querySelector('main')||document.body;if(routeCard&&routeCard.parentNode)routeCard.insertAdjacentElement('afterend',panel);else if(target!==document.body)target.appendChild(panel)}var a=q('granularCreateRoute'),b=q('granularCreateBot'),c=q('granularCreateTelegramDestination');if(a)a.addEventListener('click',createRoute);if(b)b.addEventListener('click',createBot);if(c)c.addEventListener('click',createTelegramDestination);load().catch(function(e){var el=q('granularFeedSummary');if(el)el.textContent='Granular routing data unavailable: '+String(e.message||e)})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();</script>`;
  return String(html).replace(marker, `${panel}${script}${marker}`);
}
