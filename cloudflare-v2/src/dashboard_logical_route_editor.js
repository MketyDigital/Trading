export function withLogicalRouteEditor(html) {
  const input = String(html ?? '');
  const marker = '</body>';
  if (!input.includes(marker)) return input;

  const panel = `<section id="logicalRouteEditorPanel" class="card" style="margin-top:18px">
  <h3>Create or edit route</h3>
  <p class="muted small">Choose a source, then either route all of its channels or select exactly which channels may reach one destination. Only selected channels can reach that destination in selective mode; unselected channels are ignored for that route.</p>
  <div class="grid">
    <div class="formbox">
      <div class="field"><label>Existing route</label><select id="logicalExistingRoute"><option value="">Create a new route</option></select></div>
      <div class="field"><label>Source connection</label><select id="logicalSource"><option value="">Loading sources…</option></select></div>
      <div class="field">
        <label>Channel scope</label>
        <label style="display:block;margin:6px 0"><input type="radio" name="logicalScope" id="logicalScopeAll" value="all"> All channels from this source</label>
        <label style="display:block;margin:6px 0"><input type="radio" name="logicalScope" id="logicalScopeSelective" value="selective" checked> Only selected channels</label>
      </div>
      <div class="field"><label>Allowed channels</label><div id="logicalFeedList" class="formbox"><span class="muted small">Choose a source first.</span></div></div>
      <div class="field"><label>Destination</label><select id="logicalDestination"><option value="">Loading destinations…</option></select></div>
      <div class="field"><label>Route name</label><input id="logicalRouteName" placeholder="Main → MT5"></div>
      <div class="grid">
        <div class="field"><label>Allowed symbols (optional)</label><input id="logicalAllowedSymbols" placeholder="XAUUSD, EURUSD"></div>
        <div class="field"><label>Blocked symbols (optional)</label><input id="logicalBlockedSymbols" placeholder="DERIV:VOLATILITY_75"></div>
      </div>
      <div class="muted small">Leave both symbol filters blank to allow every symbol this destination account can actually trade. Filters only narrow the destination's real broker/account capabilities; they never add unsupported symbols.</div>
      <div class="grid" style="margin-top:8px">
        <div class="field"><label>Priority</label><input id="logicalPriority" type="number" value="100"></div>
        <div class="field"><label>Route enabled</label><select id="logicalEnabled"><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
      </div>
      <div class="actions"><button id="logicalSaveRoute" class="btn primary" type="button">Save route</button><button id="logicalNewRoute" class="btn secondary" type="button">New route</button></div>
      <div id="logicalRouteMessage" class="muted small" style="margin-top:7px"></div>
    </div>
    <div class="formbox">
      <b>How routing works</b>
      <div class="muted small" style="margin-top:8px">Selective: tick one or more child channels. Only those channels may reach this destination. A previous all-channels/default row cannot silently broaden the destination once selective rows exist.</div>
      <div class="muted small" style="margin-top:8px">All channels: every authorized child channel under the selected source may reach this destination, subject to symbol, risk, account, runtime and broker capability checks.</div>
      <div class="muted small" style="margin-top:8px">Existing routes use this same editor. Sources, destinations, broker accounts, credentials and templates are not recreated just because the route selection changes.</div>
    </div>
  </div>
  <div class="grid" style="margin-top:14px">
    <div class="formbox">
      <b>Telegram destination formatting</b>
      <div class="field"><label>Telegram destination</label><select id="logicalFormattingDestination"><option value="">Select Telegram destination</option></select></div>
      <div class="field"><label>Ready-made formatting mode</label><select id="logicalFormattingPreset">
        <option value="none">Forward as-is (original)</option>
        <option value="clean">Clean original</option>
        <option value="template">Structured template</option>
        <option value="ai_then_fallback">AI presentation + safe fallback</option>
      </select></div>
      <div id="logicalFormattingDescription" class="muted small" style="margin:8px 0">No AI, no cleanup, no reformatting, no branding added. Forward the original source message as-is.</div>
      <button id="logicalApplyFormatting" class="btn secondary" type="button">Apply formatting mode</button>
      <div id="logicalFormattingMessage" class="muted small" style="margin-top:7px"></div>
    </div>
    <div class="formbox">
      <b>Formatting choices</b>
      <div class="muted small" style="margin-top:8px"><b>Forward as-is (original)</b> — original source text only. No AI, no cleanup, no reformatting, no added header/footer/disclaimer or branding.</div>
      <div class="muted small" style="margin-top:8px"><b>Clean original</b> — original content with deterministic cleanup rules only; no AI presentation.</div>
      <div class="muted small" style="margin-top:8px"><b>Structured template</b> — deterministic reconstruction using the saved template/layout and canonical interpreted signal.</div>
      <div class="muted small" style="margin-top:8px"><b>AI presentation + safe fallback</b> — AI may change presentation only. Canonical trading meaning cannot change, and deterministic fallback remains available.</div>
      <div class="muted small" style="margin-top:8px">Existing custom templates remain editable and are not removed by these ready-made choices.</div>
    </div>
  </div>
</section>`;

  const script = `<script>(function(){'use strict';
function q(id){return document.getElementById(id)}
function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
function auth(){return{workspace:sessionStorage.getItem('mketyTradingWorkspace')||'',bearer:sessionStorage.getItem('mketyTradingBearer')||''}}
async function admin(path,options){options=options||{};var a=auth();if(!a.workspace||!a.bearer)throw new Error('Your session has expired. Sign in again.');var r=await fetch(path,Object.assign({},options,{headers:Object.assign({'Accept':'application/json','Content-Type':'application/json','X-Mkety-Workspace-Id':a.workspace,'Authorization':'Bearer '+a.bearer},options.headers||{})}));var b;try{b=await r.json()}catch(_){b={ok:false,reason:'NON_JSON_RESPONSE'}}if(!r.ok||b.ok===false)throw new Error(b.reason||('HTTP_'+r.status));return b}
function ids(v){return Array.from(new Set(String(v||'').split(/[\\n,]+/).map(function(x){return x.trim().toUpperCase()}).filter(Boolean)))}
function msg(id,text,ok){var el=q(id);if(!el)return;el.textContent=text;el.className=(ok?'notice success':'notice error')+' small'}
var state={sources:[],feedsBySource:{},destinations:[],logicalRoutes:[],templates:[],editingKey:null};
function sourceName(s){return s.displayName||s.sourceInstanceId||s.id}
function currentMode(){return q('logicalScopeAll').checked?'all':'selective'}
function selectedFeeds(){return Array.from(document.querySelectorAll('#logicalFeedList input[data-feed-id]:checked')).map(function(el){return el.getAttribute('data-feed-id')}).filter(Boolean)}
function setSelectedFeeds(idsValue){var wanted=new Set(idsValue||[]);document.querySelectorAll('#logicalFeedList input[data-feed-id]').forEach(function(el){el.checked=wanted.has(el.getAttribute('data-feed-id'))})}
function renderSources(){var el=q('logicalSource');if(!el)return;el.innerHTML='<option value="">Select source</option>'+state.sources.map(function(s){return '<option value="'+esc(s.id)+'">'+esc(sourceName(s))+' • '+esc(s.providerType||'')+'</option>'}).join('')}
function renderDestinations(){var el=q('logicalDestination');if(el)el.innerHTML='<option value="">Select destination</option>'+state.destinations.map(function(d){return '<option value="'+esc(d.id)+'">'+esc(d.displayName)+' • '+esc(d.destinationType)+(d.enabled?'':' • disabled')+'</option>'}).join('');var fmt=q('logicalFormattingDestination');if(fmt)fmt.innerHTML='<option value="">Select Telegram destination</option>'+state.destinations.filter(function(d){return d.destinationType==='telegram'}).map(function(d){return '<option value="'+esc(d.id)+'">'+esc(d.displayName)+' • '+esc(d.destinationRef||'')+'</option>'}).join('')}
function renderLogicalRoutes(){var el=q('logicalExistingRoute');if(!el)return;el.innerHTML='<option value="">Create a new route</option>'+state.logicalRoutes.map(function(r){var s=state.sources.find(function(x){return x.id===r.sourceConnectionId}),d=state.destinations.find(function(x){return x.id===r.destinationId});return '<option value="'+esc(r.logicalRouteKey)+'">'+esc((s?sourceName(s):r.sourceConnectionId)+' → '+(d?d.displayName:r.destinationId))+' • '+esc(r.mode==='all'?'all channels':String((r.selectedFeedIds||[]).length)+' selected')+'</option>'}).join('');if(state.editingKey)el.value=state.editingKey}
function renderFeeds(){var sourceId=q('logicalSource').value,el=q('logicalFeedList');if(!el)return;var feeds=state.feedsBySource[sourceId]||[];if(!sourceId){el.innerHTML='<span class="muted small">Choose a source first.</span>';return}if(!feeds.length){el.innerHTML='<span class="muted small">No child channels are materialized for this source. Use All channels, or edit the source allowed-chat configuration first.</span>';return}el.innerHTML=feeds.map(function(f){return '<label style="display:block;margin:6px 0"><input type="checkbox" data-feed-id="'+esc(f.id)+'"> '+esc(f.displayName||f.providerFeedId)+(f.isActive===false?' • disabled':'')+'</label>'}).join('');syncScopeUi()}
function syncScopeUi(){var all=currentMode()==='all',box=q('logicalFeedList');if(box){box.style.opacity=all?'0.55':'1';box.querySelectorAll('input[data-feed-id]').forEach(function(el){el.disabled=all})}}
function resetRoute(){state.editingKey=null;q('logicalExistingRoute').value='';q('logicalSource').value='';q('logicalDestination').value='';q('logicalRouteName').value='';q('logicalAllowedSymbols').value='';q('logicalBlockedSymbols').value='';q('logicalPriority').value='100';q('logicalEnabled').value='true';q('logicalScopeSelective').checked=true;q('logicalScopeAll').checked=false;renderFeeds();msg('logicalRouteMessage','',true)}
function loadRoute(key){var r=state.logicalRoutes.find(function(x){return x.logicalRouteKey===key});if(!r){resetRoute();return}state.editingKey=key;q('logicalSource').value=r.sourceConnectionId||'';renderFeeds();q('logicalDestination').value=r.destinationId||'';q('logicalRouteName').value=r.routeName||'';q('logicalAllowedSymbols').value=((r.filters||{}).allowedCanonicalSymbols||[]).join(', ');q('logicalBlockedSymbols').value=((r.filters||{}).blockedCanonicalSymbols||[]).join(', ');q('logicalPriority').value=String(r.priority==null?100:r.priority);q('logicalEnabled').value=r.enabled===false?'false':'true';q('logicalScopeAll').checked=r.mode==='all';q('logicalScopeSelective').checked=r.mode!=='all';setSelectedFeeds(r.selectedFeedIds||[]);syncScopeUi()}
async function load(){var jobs=await Promise.allSettled([admin('/api/v1/admin/sources'),admin('/api/v1/admin/destinations'),admin('/api/v1/admin/logical-routes'),admin('/api/v1/admin/templates')]);state.sources=jobs[0].status==='fulfilled'?(jobs[0].value.sources||[]):[];state.destinations=jobs[1].status==='fulfilled'?(jobs[1].value.destinations||[]):[];state.logicalRoutes=jobs[2].status==='fulfilled'?(jobs[2].value.logicalRoutes||[]):[];state.templates=jobs[3].status==='fulfilled'?(jobs[3].value.templates||[]):[];var feedRows=await Promise.all(state.sources.map(async function(s){try{var r=await admin('/api/v1/admin/sources/'+encodeURIComponent(s.id)+'/feeds');return[s.id,r.feeds||[]]}catch(_){return[s.id,[]]}}));state.feedsBySource=Object.fromEntries(feedRows);renderSources();renderDestinations();renderLogicalRoutes();renderFeeds()}
async function saveRoute(){var sourceConnectionId=q('logicalSource').value,destinationId=q('logicalDestination').value,mode=currentMode(),feeds=selectedFeeds();if(!sourceConnectionId||!destinationId){msg('logicalRouteMessage','Choose a source and destination.',false);return}if(mode==='selective'&&!feeds.length){msg('logicalRouteMessage','Select at least one allowed channel, or choose All channels from this source.',false);return}var filters={},allowed=ids(q('logicalAllowedSymbols').value),blocked=ids(q('logicalBlockedSymbols').value);if(allowed.length)filters.allowedCanonicalSymbols=allowed;if(blocked.length)filters.blockedCanonicalSymbols=blocked;var payload={sourceConnectionId:sourceConnectionId,destinationId:destinationId,mode:mode,selectedFeedIds:mode==='selective'?feeds:[],routeName:q('logicalRouteName').value.trim()||null,priority:Number(q('logicalPriority').value||100),enabled:q('logicalEnabled').value!=='false',filters:filters};try{await admin('/api/v1/admin/logical-routes/reconcile',{method:'PUT',body:JSON.stringify(payload)});msg('logicalRouteMessage',mode==='all'?'Route saved for all channels from this source.':'Selective route saved. Only the checked channels can reach this destination.',true);state.editingKey=sourceConnectionId+'::'+destinationId;await load()}catch(e){msg('logicalRouteMessage','Route save failed: '+String(e.message||e),false)}}
var presetCopy={none:'No AI, no cleanup, no reformatting, no branding added. Forward the original source message as-is.',clean:'Keep the original content and apply deterministic cleanup rules only. No AI presentation.',template:'Reconstruct the interpreted signal deterministically using the saved structured template and canonical fields.',ai_then_fallback:'AI may improve presentation only. Trading meaning cannot change; deterministic formatting is used as the safe fallback.'};
var presetNames={none:'Mkety — Forward as-is (original)',clean:'Mkety — Clean original',template:'Mkety — Structured template',ai_then_fallback:'Mkety — AI presentation + safe fallback'};
function describePreset(){var mode=q('logicalFormattingPreset').value;q('logicalFormattingDescription').textContent=presetCopy[mode]||''}
async function ensurePreset(mode){var name=presetNames[mode],existing=state.templates.find(function(t){return t.templateName===name&&t.formattingMode===mode});if(existing)return existing;var parseMode=(mode==='none'||mode==='clean')?'plain':'HTML';var created=await admin('/api/v1/admin/templates',{method:'POST',body:JSON.stringify({templateName:name,formattingMode:mode,parseMode:parseMode,cleanupRules:{},layout:{mketyPreset:mode},isDefault:false})});var template=created.template;if(template)state.templates.push(template);return template}
async function applyFormatting(){var destinationId=q('logicalFormattingDestination').value,mode=q('logicalFormattingPreset').value;if(!destinationId){msg('logicalFormattingMessage','Choose a Telegram destination first.',false);return}var d=state.destinations.find(function(x){return x.id===destinationId});if(!d||d.destinationType!=='telegram'){msg('logicalFormattingMessage','Choose a valid Telegram destination.',false);return}try{var template=await ensurePreset(mode);if(!template||!template.id)throw new Error('PRESET_TEMPLATE_CREATE_FAILED');await admin('/api/v1/admin/destinations/'+encodeURIComponent(d.id),{method:'PUT',body:JSON.stringify({displayName:d.displayName,destinationRef:d.destinationRef,templateId:template.id,settings:d.settings||{}})});msg('logicalFormattingMessage',(presetNames[mode]||mode)+' applied. Existing bot credentials and endpoint identity were preserved.',true);await load()}catch(e){msg('logicalFormattingMessage','Formatting update failed: '+String(e.message||e),false)}}
function hideLegacyRouteForm(){var old=q('granularExistingRoute');if(!old)return;var box=old.closest('.formbox');if(box)box.style.display='none'}
function bind(){var existing=q('logicalExistingRoute'),source=q('logicalSource');if(existing)existing.addEventListener('change',function(){loadRoute(existing.value)});if(source)source.addEventListener('change',function(){renderFeeds();if(!state.editingKey)setSelectedFeeds([])});['logicalScopeAll','logicalScopeSelective'].forEach(function(id){var el=q(id);if(el)el.addEventListener('change',syncScopeUi)});q('logicalSaveRoute')?.addEventListener('click',saveRoute);q('logicalNewRoute')?.addEventListener('click',resetRoute);q('logicalFormattingPreset')?.addEventListener('change',describePreset);q('logicalApplyFormatting')?.addEventListener('click',applyFormatting)}
function start(){hideLegacyRouteForm();bind();describePreset();load().catch(function(e){msg('logicalRouteMessage','Could not load routing controls: '+String(e.message||e),false)})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();</script>`;

  return input.replace(marker, `${panel}${script}${marker}`);
}
