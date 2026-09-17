function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function renderMketyAdminOperationsPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mkety Operations Diagnostics</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui;color:#eef4ff;background:#07111f}*{box-sizing:border-box}body{margin:0;background:#07111f}.wrap{max-width:1400px;margin:auto;padding:28px 20px 60px}.card{background:#0c1a2c;border:1px solid #203a59;border-radius:16px;padding:18px;margin-top:18px}.muted{color:#9fb2cc}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.field{display:flex;flex-direction:column;gap:6px}.field label{font-size:12px;color:#b9c9dd}.field input,.field select{background:#081522;color:#eef4ff;border:1px solid #2b496b;border-radius:10px;padding:10px}.toolbar{display:flex;gap:9px;align-items:center;justify-content:space-between;flex-wrap:wrap}.actions{display:flex;gap:8px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;background:#38a3ff;color:#04101c}.secondary{background:#17304b;color:#eef4ff}.error{color:#ff9ca8;margin-top:10px}.table-wrap{overflow:auto;margin-top:12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:9px;border-bottom:1px solid #203a59;vertical-align:top}th{color:#9fb2cc;text-transform:uppercase;font-size:11px}.pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#17304b}.code{white-space:pre-wrap;word-break:break-word;font:11px ui-monospace,monospace;color:#cfe4ff}.empty{text-align:center;color:#9fb2cc;padding:20px}.small{font-size:12px}a{color:#79c3ff}
</style></head><body><main class="wrap">
<div class="toolbar"><div><h1>Mkety Operations Diagnostics</h1><p class="muted">Site-wide support view for normalized trading lifecycle evidence. Filter by workspace or correlation ID to trace one customer operation end to end.</p></div><a href="/mkety-admin/access-codes">Back to Staff Trading Admin</a></div>
<section class="card"><div class="field"><label for="staffSecret">Mkety Trading admin secret (memory only)</label><input id="staffSecret" type="password" autocomplete="off" placeholder="Enter MKETY_TRADING_ADMIN_SECRET"></div><div id="pageError" class="error" role="alert"></div></section>
<section class="card"><div class="toolbar"><div><h2>Filters</h2><div class="muted small">All filters are optional. Empty filters show the most recent site-wide evidence.</div></div><div class="actions"><button id="loadBtn">Load diagnostics</button><button id="clearBtn" class="secondary">Clear filters</button></div></div>
<div class="grid">
<div class="field"><label for="workspaceId">Workspace ID</label><input id="workspaceId"></div>
<div class="field"><label for="correlationId">Correlation ID</label><input id="correlationId"></div>
<div class="field"><label for="sourceConnectionId">Source connection ID</label><input id="sourceConnectionId"></div>
<div class="field"><label for="sourceFeedId">Source feed ID</label><input id="sourceFeedId"></div>
<div class="field"><label for="routeId">Route ID</label><input id="routeId"></div>
<div class="field"><label for="destinationId">Destination ID</label><input id="destinationId"></div>
<div class="field"><label for="tradeAccountId">Trade account ID</label><input id="tradeAccountId"></div>
<div class="field"><label for="aiProviderId">AI provider ID</label><input id="aiProviderId"></div>
<div class="field"><label for="stage">Stage</label><select id="stage"><option value="">Any</option><option>INGRESS</option><option>AUTHORIZATION</option><option>INTERPRETATION</option><option>AI_PROVIDER</option><option>CORRELATION</option><option>ROUTE</option><option>DESTINATION</option><option>BROKER_PLANNING</option><option>BROKER_EXECUTION</option><option>MANAGEMENT</option><option>REPLAY</option><option>RECONCILIATION</option><option>CONNECTOR</option><option>PERSISTENCE</option></select></div>
<div class="field"><label for="status">Status</label><select id="status"><option value="">Any</option><option>SUCCEEDED</option><option>FAILED</option><option>SKIPPED</option><option>BLOCKED</option><option>RETRYABLE</option><option>UNCERTAIN</option><option>INFO</option></select></div>
<div class="field"><label for="fromAt">From</label><input id="fromAt" type="datetime-local"></div>
<div class="field"><label for="toAt">To</label><input id="toAt" type="datetime-local"></div>
</div></section>
<section class="card"><div class="toolbar"><div><h2>Lifecycle evidence</h2><div id="resultMeta" class="muted small">Enter the staff secret and load diagnostics.</div></div><button id="moreBtn" class="secondary" disabled>Load older</button></div><div class="table-wrap"><table><thead><tr><th>Time</th><th>Workspace</th><th>Correlation</th><th>Stage</th><th>Status</th><th>Operation / Error</th><th>Resources</th><th>Details</th></tr></thead><tbody id="operationRows"><tr><td colspan="8" class="empty">No diagnostics loaded.</td></tr></tbody></table></div></section>
</main><script>(()=>{'use strict';
const API='/api/v1/mkety-admin/operations',$=(id)=>document.getElementById(id);let nextBefore=null;
const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ids=['workspaceId','correlationId','sourceConnectionId','sourceFeedId','routeId','destinationId','tradeAccountId','aiProviderId','stage','status'];
function headers(){return{'X-Mkety-Admin-Secret':$('staffSecret').value,'Accept':'application/json'}}
function iso(id){const v=$(id).value;return v?new Date(v).toISOString():''}
function query(older=false){const p=new URLSearchParams();for(const id of ids){const v=$(id).value.trim();if(v)p.set(id,v)}const from=iso('fromAt'),to=iso('toAt');if(from)p.set('from',from);if(to)p.set('to',to);p.set('limit','100');if(older&&nextBefore)p.set('before',nextBefore);return p}
async function request(older=false){const r=await fetch(API+'?'+query(older).toString(),{headers:headers()});let b={};try{b=await r.json()}catch{}if(!r.ok||!b.ok)throw new Error(b.reason||('HTTP '+r.status));return b}
function resources(x){return[['event',x.tradingEventId],['source',x.sourceConnectionId],['feed',x.sourceFeedId],['route',x.routeId],['destination',x.destinationId],['account',x.tradeAccountId],['AI',x.aiProviderId],['group',x.positionGroupId],['connector',x.connectorId]].filter(([,v])=>v).map(([k,v])=>'<div><b>'+esc(k)+':</b> '+esc(v)+'</div>').join('')||'—'}
function render(rows,append=false){const body=$('operationRows');if(!append)body.innerHTML='';if(!rows.length&&!append){body.innerHTML='<tr><td colspan="8" class="empty">No matching lifecycle evidence.</td></tr>';return}body.insertAdjacentHTML('beforeend',rows.map((x)=>'<tr><td>'+esc(x.observedAt||'—')+'</td><td>'+esc(x.workspaceId||'—')+'</td><td class="code">'+esc(x.correlationId||'—')+'</td><td>'+esc(x.stage||'—')+'</td><td><span class="pill">'+esc(x.status||'—')+'</span></td><td><b>'+esc(x.operation||'—')+'</b><div>'+esc(x.summary||'')+'</div><div class="muted">'+esc(x.errorCode||x.failureClass||'')+'</div></td><td>'+resources(x)+'</td><td class="code">'+esc(JSON.stringify(x.details||{},null,2))+'</td></tr>').join(''))}
async function load(older=false){$('pageError').textContent='';try{const b=await request(older);render(b.operations||[],older);nextBefore=b.nextBefore||null;$('moreBtn').disabled=!nextBefore;$('resultMeta').textContent=(b.operations||[]).length+' operation record(s) loaded.'}catch(e){$('pageError').textContent=e.message}}
$('loadBtn').addEventListener('click',()=>load(false));$('moreBtn').addEventListener('click',()=>load(true));$('clearBtn').addEventListener('click',()=>{for(const id of ids)$(id).value='';$('fromAt').value='';$('toAt').value='';nextBefore=null;$('operationRows').innerHTML='<tr><td colspan="8" class="empty">Filters cleared.</td></tr>';$('moreBtn').disabled=true});
})();</script></body></html>`;
}

export { esc as escapeMketyAdminOperationsHtml };
