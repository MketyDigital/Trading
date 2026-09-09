import fs from 'node:fs';

const sourcePath = 'cloudflare-v2/src/http/v1_admin_sources.js';
const sourceText = fs.readFileSync(sourcePath, 'utf8');
if (!sourceText.includes('oneTimeEndpointUrl')) {
  throw new Error(`${sourcePath}: external MTProto endpoint implementation is missing`);
}
console.log(`${sourcePath}: backend implementation present`);

const portal = 'cloudflare-v2/src/dashboard_enterprise_portal.js';
let html = fs.readFileSync(portal, 'utf8');
if (!html.includes('one-time MTProto endpoint')) {
  const start = html.indexOf('async function createSource(){');
  const end = html.indexOf('\nasync function createAccount(){', start);
  if (start < 0 || end < 0) throw new Error(`${portal}: createSource function boundaries not found`);
  const newFn = `async function createSource(){try{var d=sourceDefinition(),p=d.providerType,payload={providerType:p,sourceFamily:d.sourceFamily,sourceType:d.sourceType,sourceInstanceId:document.getElementById('sourceInstance').value.trim(),displayName:document.getElementById('sourceName').value.trim(),priority:Number(document.getElementById('sourcePriority').value||0)};var c=sourceCredentials(p);if(c)payload.credentials=c;var r=await api('/api/v1/admin/sources',{method:'POST',body:JSON.stringify(payload)});var endpoint=r.oneTimeEndpointUrl;if(endpoint)alert('Copy this one-time MTProto endpoint now:\\\n'+endpoint);var secret=r.oneTimeSigningSecret||r.signingSecret||r.ingressSecret||r.secret;if(secret)alert('Copy this one-time signing secret now:\\\n'+secret);await loadAll()}catch(e){msg('workspaceMessage','Source failed: '+friendlyError(e),'error')}}`;
  html = html.slice(0, start) + newFn + html.slice(end);
  fs.writeFileSync(portal, html);
  console.log(`${portal}: patched`);
} else {
  console.log(`${portal}: UI implementation already present`);
}
