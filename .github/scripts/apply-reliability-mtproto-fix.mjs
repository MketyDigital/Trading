import fs from 'node:fs';

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) {
    console.log(`${path}: implementation already present`);
    return false;
  }
  if (!text.includes(oldText)) throw new Error(`${path}: expected source block not found`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
  console.log(`${path}: patched`);
  return true;
}

replaceOnce(
  'cloudflare-v2/src/http/v1_admin_sources.js',
  `        if (parsed.input.providerType === 'custom_signed_api') {
          return json({ ok: true, workspaceId, source: safeSource, oneTimeSigningSecret: ingressSecret }, 201);
        }
        return json({ ok: true, workspaceId, source: safeSource }, 201);`,
  `        if (parsed.input.providerType === 'custom_signed_api') {
          return json({ ok: true, workspaceId, source: safeSource, oneTimeSigningSecret: ingressSecret }, 201);
        }
        if (parsed.input.providerType === 'external_mtproto') {
          const configuredCanonical = String(env.TRADING_CANONICAL_HOSTS || 'trade.mkety.com')
            .split(',')
            .map((value) => value.trim())
            .find(Boolean) || 'trade.mkety.com';
          const canonicalOrigin = /^https?:\\/\\//i.test(configuredCanonical)
            ? configuredCanonical.replace(/\\/$/, '')
            : 'https://' + configuredCanonical;
          const oneTimeEndpointUrl = canonicalOrigin
            + '/api/v1/external/mtproto/' + encodeURIComponent(source.id)
            + '/' + encodeURIComponent(ingressSecret);
          return json({ ok: true, workspaceId, source: safeSource, oneTimeEndpointUrl }, 201);
        }
        return json({ ok: true, workspaceId, source: safeSource }, 201);`,
  'oneTimeEndpointUrl',
);

const portal = 'cloudflare-v2/src/dashboard_enterprise_portal.js';
let html = fs.readFileSync(portal, 'utf8');
if (!html.includes('one-time MTProto endpoint')) {
  const oldFn = `async function createSource(){try{var d=sourceDefinition(),p=d.providerType,payload={providerType:p,sourceFamily:d.sourceFamily,sourceType:d.sourceType,sourceInstanceId:document.getElementById('sourceInstance').value.trim(),displayName:document.getElementById('sourceName').value.trim(),priority:Number(document.getElementById('sourcePriority').value||0)};var c=sourceCredentials(p);if(c)payload.credentials=c;var r=await api('/api/v1/admin/sources',{method:'POST',body:JSON.stringify(payload)});var secret=r.signingSecret||r.ingressSecret||r.secret;if(secret)alert('Copy this one-time signing secret now:\\\n'+secret);await loadAll()}catch(e){msg('workspaceMessage','Source failed: '+friendlyError(e),'error')}}`;
  const newFn = `async function createSource(){try{var d=sourceDefinition(),p=d.providerType,payload={providerType:p,sourceFamily:d.sourceFamily,sourceType:d.sourceType,sourceInstanceId:document.getElementById('sourceInstance').value.trim(),displayName:document.getElementById('sourceName').value.trim(),priority:Number(document.getElementById('sourcePriority').value||0)};var c=sourceCredentials(p);if(c)payload.credentials=c;var r=await api('/api/v1/admin/sources',{method:'POST',body:JSON.stringify(payload)});var endpoint=r.oneTimeEndpointUrl;if(endpoint)alert('Copy this one-time MTProto endpoint now:\\\n'+endpoint);var secret=r.oneTimeSigningSecret||r.signingSecret||r.ingressSecret||r.secret;if(secret)alert('Copy this one-time signing secret now:\\\n'+secret);await loadAll()}catch(e){msg('workspaceMessage','Source failed: '+friendlyError(e),'error')}}`;
  if (!html.includes(oldFn)) throw new Error(`${portal}: createSource block not found`);
  html = html.replace(oldFn, newFn);
  fs.writeFileSync(portal, html);
  console.log(`${portal}: patched`);
} else {
  console.log(`${portal}: implementation already present`);
}
