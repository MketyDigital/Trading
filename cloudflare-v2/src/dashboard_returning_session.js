export function withReturningOwnerSession(html) {
  const script = `<script>(function(){
async function restoreReturningOwner(){
  if(sessionStorage.getItem('mketyTradingBearer'))return;
  try{
    var r=await fetch('/api/v1/access/session',{method:'POST',headers:{Accept:'application/json'},credentials:'include'});
    if(!r.ok)return;
    var x=await r.json();
    if(!x||!x.ok||!x.bearer||!x.workspace||!x.workspace.id)return;
    var context={workspace:x.workspace,bearer:x.bearer,entitlements:x.entitlements||{},brokerExecutionEnabled:x.brokerExecutionEnabled===true};
    if(typeof window.mketyTradingSessionSet==='function')window.mketyTradingSessionSet(context);
    else{
      localStorage.setItem('mketyTradingWorkspace',x.workspace.id);
      sessionStorage.setItem('mketyTradingBearer',x.bearer);
      sessionStorage.setItem('mketyTradingContext',JSON.stringify(context));
    }
    location.reload();
  }catch(_){}
}
async function logoutReturningOwner(ev){
  var target=ev.target&&ev.target.closest?ev.target.closest('#portalLogout,#logoutBtn'):null;
  if(!target)return;
  ev.preventDefault();ev.stopImmediatePropagation();
  try{await fetch('/api/v1/access/logout',{method:'POST',credentials:'include'});}catch(_){}
  if(typeof window.mketyTradingSessionClear==='function')window.mketyTradingSessionClear();
  else{
    sessionStorage.removeItem('mketyTradingBearer');
    sessionStorage.removeItem('mketyTradingContext');
    localStorage.removeItem('mketyTradingWorkspace');
  }
  location.reload();
}
document.addEventListener('click',logoutReturningOwner,true);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',restoreReturningOwner);else restoreReturningOwner();
})();</script>`;
  return String(html).replace('</body>', `${script}</body>`);
}
