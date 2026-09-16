export function withReturningOwnerSession(html) {
  const script = `<script>(function(){
var nativeFetch=window.fetch.bind(window);
var refreshInFlight=null;
function clearLocalSession(){
  if(typeof window.mketyTradingSessionClear==='function')window.mketyTradingSessionClear();
  sessionStorage.removeItem('mketyTradingWorkspace');sessionStorage.removeItem('mketyTradingBearer');sessionStorage.removeItem('mketyTradingEntitlements');sessionStorage.removeItem('mketyTradingWorkspaceName');sessionStorage.removeItem('mketyTradingContext');localStorage.removeItem('mketyTradingWorkspace');localStorage.removeItem('mketyTradingWorkspaceId');
}
function showAccessNotice(reason){
  var messages={ACCESS_SUBSCRIPTION_EXPIRED:'Your Mkety Trading access has expired. Contact Mkety to renew your subscription and receive a new access code.',ACCESS_CODE_EXPIRED:'Your Mkety Trading access has expired. Contact Mkety to renew your subscription and receive a new access code.',ACCESS_SUBSCRIPTION_REVOKED:'This Mkety Trading workspace is currently locked. Contact Mkety to restore access.',TRADING_WORKSPACE_DISABLED:'This Mkety Trading workspace is currently locked. Contact Mkety to restore access.',TRADING_ACCESS_DISABLED:'This Mkety Trading workspace is currently locked. Contact Mkety to restore access.'};
  var text=messages[reason];if(!text)return;var el=document.getElementById('returningAccessNotice');if(!el){el=document.createElement('div');el.id='returningAccessNotice';el.className='notice error';el.style.cssText='margin:14px auto;max-width:980px;padding:12px 14px;border-radius:10px;background:#fff1f2;color:#9f1239;border:1px solid #fecdd3;font-weight:700';document.body.insertAdjacentElement('afterbegin',el)}el.textContent=text;
}
function applyRenewedSession(x){
  if(!x||!x.ok||!x.bearer||!x.workspace||!x.workspace.id)return false;
  var context={workspace:x.workspace,bearer:x.bearer,entitlements:x.entitlements||{},brokerExecutionEnabled:x.brokerExecutionEnabled===true};
  sessionStorage.setItem('mketyTradingWorkspace',String(x.workspace.id));sessionStorage.setItem('mketyTradingBearer',String(x.bearer));sessionStorage.setItem('mketyTradingEntitlements',JSON.stringify(x.entitlements||{}));sessionStorage.setItem('mketyTradingWorkspaceName',String(x.workspace.name||''));sessionStorage.setItem('mketyTradingContext',JSON.stringify(context));localStorage.setItem('mketyTradingWorkspaceId',String(x.workspace.id));localStorage.setItem('mketyTradingWorkspace',String(x.workspace.id));if(typeof window.mketyTradingSessionSet==='function')window.mketyTradingSessionSet(context);return true;
}
async function renewReturningOwner(){
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=(async function(){try{var r=await nativeFetch('/api/v1/access/session',{method:'POST',headers:{Accept:'application/json'},credentials:'include'});var x=null;try{x=await r.json()}catch(_){}if(!r.ok){if(x&&x.reason){clearLocalSession();showAccessNotice(x.reason)}return null}return applyRenewedSession(x)?x:null}catch(_){return null}finally{refreshInFlight=null}})();return refreshInFlight;
}
async function restoreReturningOwner(){if(sessionStorage.getItem('mketyTradingBearer'))return {ok:true,restored:false};try{return await renewReturningOwner()}catch(_){return null}}
window.mketyTradingRestoreSession=restoreReturningOwner;window.mketyTradingSessionRestorePromise=restoreReturningOwner();
window.fetch=async function(input,init){
  var response=await nativeFetch(input,init);var requestUrl='';try{requestUrl=typeof input==='string'?new URL(input,location.href).pathname:new URL(input.url,location.href).pathname}catch(_){return response}if(!requestUrl.startsWith('/api/v1/admin/'))return response;
  var body=null;try{body=await response.clone().json()}catch(_){}
  if(response.status===403&&body&&['ACCESS_SUBSCRIPTION_EXPIRED','ACCESS_SUBSCRIPTION_REVOKED','TRADING_WORKSPACE_DISABLED','TRADING_ACCESS_DISABLED'].includes(body.reason)){clearLocalSession();showAccessNotice(body.reason);return response}
  if(response.status!==401||!body||body.reason!=='TOKEN_EXPIRED')return response;
  var renewed=await renewReturningOwner();if(!renewed)return response;var headers=new Headers((init&&init.headers)||(typeof input!=='string'&&input.headers)||{});headers.set('Authorization','Bearer '+renewed.bearer);headers.set('X-Mkety-Workspace-Id',String(renewed.workspace.id));return nativeFetch(input,Object.assign({},init||{},{headers:headers}));
};
async function logoutReturningOwner(ev){var target=ev.target&&ev.target.closest?ev.target.closest('#portalLogout,#logoutBtn'):null;if(!target)return;ev.preventDefault();ev.stopImmediatePropagation();try{await nativeFetch('/api/v1/access/logout',{method:'POST',credentials:'include'});}catch(_){}clearLocalSession();location.reload()}
document.addEventListener('click',logoutReturningOwner,true);
})();</script>`;

  let output = String(html);
  output = output.replace(/<body([^>]*)>/i, (match) => `${match}${script}`);
  output = output.replace(
    'async function api(path,options){options=options||{};var s=session();',
    "async function awaitReturningSession(){if(window.mketyTradingSessionRestorePromise)await window.mketyTradingSessionRestorePromise;}\nasync function api(path,options){options=options||{};await awaitReturningSession();var s=session();",
  );
  output = output.replace(
    "async function admin(path,options){options=options||{};var s=auth();",
    "async function admin(path,options){options=options||{};if(window.mketyTradingSessionRestorePromise)await window.mketyTradingSessionRestorePromise;var s=auth();",
  );
  output = output.replace(
    'renderSourceFields();renderAccountFields();renderDestinationFields();showWorkspace();',
    'renderSourceFields();renderAccountFields();renderDestinationFields();(async function(){await awaitReturningSession();showWorkspace()})();',
  );
  output = output.replace(
    'function init(){ensureSourceExtras();',
    'async function init(){if(window.mketyTradingSessionRestorePromise)await window.mketyTradingSessionRestorePromise;ensureSourceExtras();',
  );
  return output;
}
