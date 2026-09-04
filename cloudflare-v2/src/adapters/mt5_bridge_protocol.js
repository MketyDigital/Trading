const textEncoder = new TextEncoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqualHex(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export function buildMT5BridgeEnvelope({ commandId, workspaceId, accountId, issuedAt = Date.now(), ttlMs = 15000, command } = {}) {
  if (!commandId || !workspaceId || !accountId || !command?.action) throw new TypeError('commandId, workspaceId, accountId and command.action are required');
  const issued = Number(issuedAt);
  const ttl = Number(ttlMs);
  if (!Number.isFinite(issued) || !Number.isFinite(ttl) || ttl <= 0) throw new TypeError('valid issuedAt and ttlMs required');
  return {
    version: 'mkety.mt5.v1',
    command_id: String(commandId),
    workspace_id: String(workspaceId),
    account_id: String(accountId),
    issued_at: issued,
    expires_at: issued + ttl,
    command,
  };
}

async function importHmacKey(secret) {
  if (!secret) throw new TypeError('shared secret required');
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function signMT5BridgeBody(rawBody, secret) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(String(rawBody)));
  return `v1=${toHex(signature)}`;
}

export async function signMT5MetadataRequest({ method = 'GET', target, timestamp = Date.now(), secret } = {}) {
  const normalizedMethod = String(method || '').trim().toUpperCase();
  const normalizedTarget = String(target || '').trim();
  const normalizedTimestamp = String(timestamp ?? '').trim();
  if (normalizedMethod !== 'GET' || !normalizedTarget.startsWith('/v1/') || !/^\d+$/.test(normalizedTimestamp)) {
    throw new TypeError('valid MT5 metadata request method, target and timestamp required');
  }
  const key = await importHmacKey(secret);
  const payload = `${normalizedMethod}\n${normalizedTarget}\n${normalizedTimestamp}`;
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  return `v1=${toHex(signature)}`;
}

export async function verifyMT5BridgeSignature(rawBody, secret, suppliedSignature) {
  if (!String(suppliedSignature ?? '').startsWith('v1=')) return false;
  const expected = await signMT5BridgeBody(rawBody, secret);
  return constantTimeEqualHex(expected, String(suppliedSignature));
}

export function validateMT5BridgeEnvelope(envelope, { nowMs = Date.now(), maxFutureSkewMs = 30000 } = {}) {
  if (envelope?.version !== 'mkety.mt5.v1') return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  if (!envelope?.command_id || !envelope?.workspace_id || !envelope?.account_id || !envelope?.command?.action) {
    return { ok: false, reason: 'MISSING_SCOPE_OR_COMMAND' };
  }

  const now = Number(nowMs);
  const issuedAt = Number(envelope.issued_at);
  const expiresAt = Number(envelope.expires_at);
  if (!Number.isFinite(now) || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
    return { ok: false, reason: 'INVALID_TIMESTAMPS' };
  }
  if (issuedAt > now + Number(maxFutureSkewMs)) return { ok: false, reason: 'ISSUED_IN_FUTURE' };
  if (expiresAt < now) return { ok: false, reason: 'EXPIRED' };
  return { ok: true };
}