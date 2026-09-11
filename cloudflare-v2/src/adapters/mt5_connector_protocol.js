const encoder = new TextEncoder();

function toBase64Url(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function importKey(secret) {
  if (!secret) throw new TypeError('signing key required');
  return crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
async function signPayload(payload, secret) {
  const key = await importKey(secret);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function createMt5ConnectorToken({ accountRowId, signingKey, issuedAt = Date.now(), ttlMs = 365 * 24 * 60 * 60 * 1000, nonce = crypto.randomUUID() } = {}) {
  const id = String(accountRowId ?? '').trim();
  const issued = Number(issuedAt); const ttl = Number(ttlMs);
  if (!id || !signingKey || !Number.isFinite(issued) || !Number.isFinite(ttl) || ttl <= 0) throw new TypeError('accountRowId, signingKey and positive ttl required');
  const payload = toBase64Url(JSON.stringify({ v: 1, p: 'mt5', a: id, e: issued + ttl, n: String(nonce) }));
  return `mt5v1.${payload}.${await signPayload(payload, signingKey)}`;
}

export function buildMt5ConnectorEnvelope({ commandId, workspaceId, accountId, brokerAccountId, issuedAt = Date.now(), ttlMs = 15000, command } = {}) {
  if (!commandId || !workspaceId || !accountId || !brokerAccountId || !command?.action) throw new TypeError('command scope required');
  const issued = Number(issuedAt); const ttl = Number(ttlMs);
  if (!Number.isFinite(issued) || !Number.isFinite(ttl) || ttl <= 0) throw new TypeError('valid timestamps required');
  return {
    version: 'mkety.mt5.connector.v1',
    command_id: String(commandId),
    workspace_id: String(workspaceId),
    account_id: String(accountId),
    broker_account_id: String(brokerAccountId),
    issued_at: issued,
    expires_at: issued + ttl,
    command,
  };
}
