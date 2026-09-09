export function withReturningOwnerSession(html) {
  const script = `<script>(function(){
var nativeFetch=window.fetch.bind(window);
var refreshInFlight=null;
function applyRenewedSession(x){
  if(!x||!x.ok||!x.bearer||!x.workspace||!x.workspace.id)return false;
  var context={workspace:x.workspace,bearer:x.bearer,entitlements:x.entitlements||{},brokerExecutionEnabled:x.brokerExecutionEnabled===true};
  sessionStorage.setItem('mketyTradingWorkspace',String(x.workspace.id));
  sessionStorage.setItem('mketyTradingBearer',String(x.bearer));
  sessionStorage.setItem('mketyTradingEntitlements',JSON.stringify(x.entitlements||{}));
  sessionStorage.setItem('mketyTradingWorkspaceName',String(x.workspace.name||''));
  sessionStorage.setItem('mketyTradingContext',JSON.stringify(context));
  localStorage.setItem('mketyTradingWorkspaceId',String(x.workspace.id));
  localStorage.setItem('mketyTradingWorkspace',String(x.workspace.id));
  if(typeof window.mketyTradingSessionSet==='function')window.mketyTradingSessionSet(context);
  return true;
}
async function renewReturningOwner(){
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=(async function(){
    try{
      var r=await nativeFetch('/api/v1/access/session',{method:'POST',headers:{Accept:'application/json'},credentials:'include'});
      if(!r.ok)return null;
      var x=await r.json();
      return applyRenewedSession(x)?x:null;
    }catch(_){return null}
    finally{refreshInFlight=null}
  })();
  return refreshInFlight;
}
window.fetch=async function(input,init){
  var response=await nativeFetch(input,init);
  if(response.status!==401)return response;
  var requestUrl='';
  try{requestUrl=typeof input==='string'?new URL(input,location.href).pathname:new URL(input.url,location.href).pathname}catch(_){return response}
  if(!requestUrl.startsWith('/api/v1/admin/'))return response;
  var body=null;
  try{body=await response.clone().json()}catch(_){}
  if(!body||body.reason!=='TOKEN_EXPIRED')return response;
  var renewed=await renewReturningOwner();
  if(!renewed)return response;
  var headers=new Headers((init&&init.headers)||(typeof input!=='string'&&input.headers)||{});
  headers.set('Authorization','Bearer '+renewed.bearer);
  headers.set('X-Mkety-Workspace-Id',String(renewed.workspace.id));
  return nativeFetch(input,Object.assign({},init||{},{headers:headers}));
};
async function restoreReturningOwner(){
  if(sessionStorage.getItem('mketyTradingBearer'))return;
  try{
    var x=await renewReturningOwner();
    if(!x)return;
    location.reload();
  }catch(_){}
}
async function logoutReturningOwner(ev){
  var target=ev.target&&ev.target.closest?ev.target.closest('#portalLogout,#logoutBtn'):null;
  if(!target)return;
  ev.preventDefault();ev.stopImmediatePropagation();
  try{await nativeFetch('/api/v1/access/logout',{method:'POST',credentials:'include'});}catch(_){}
  if(typeof window.mketyTradingSessionClear==='function')window.mketyTradingSessionClear();
  sessionStorage.removeItem('mketyTradingWorkspace');
  sessionStorage.removeItem('mketyTradingBearer');
  sessionStorage.removeItem('mketyTradingEntitlements');
  sessionStorage.removeItem('mketyTradingWorkspaceName');
  sessionStorage.removeItem('mketyTradingContext');
  localStorage.removeItem('mketyTradingWorkspace');
  localStorage.removeItem('mketyTradingWorkspaceId');
  location.reload();
}
document.addEventListener('click',logoutReturningOwner,true);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',restoreReturningOwner);else restoreReturningOwner();
})();</script>`;
  return String(html).replace('</body>', `${script}</body>`);
}
