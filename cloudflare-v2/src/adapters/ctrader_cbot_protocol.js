const textEncoder = new TextEncoder();

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function importHmacKey(secret) {
  if (!secret) throw new TypeError('shared secret required');
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export function buildCTraderCbotEnvelope({ commandId, workspaceId, accountId, issuedAt = Date.now(), ttlMs = 15000, command } = {}) {
  if (!commandId || !workspaceId || !accountId || !command?.action) {
    throw new TypeError('commandId, workspaceId, accountId and command.action are required');
  }
  const issued = Number(issuedAt);
  const ttl = Number(ttlMs);
  if (!Number.isFinite(issued) || !Number.isFinite(ttl) || ttl <= 0) throw new TypeError('valid issuedAt and ttlMs required');
  return {
    version: 'mkety.ctrader.cbot.v1',
    command_id: String(commandId),
    workspace_id: String(workspaceId),
    account_id: String(accountId),
    issued_at: issued,
    expires_at: issued + ttl,
    command,
  };
}

export async function signCTraderCbotBody(rawBody, secret) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(String(rawBody)));
  return `v1=${toHex(signature)}`;
}

export function validateCTraderCbotEnvelope(envelope, { nowMs = Date.now(), expectedAccountId = null, maxFutureSkewMs = 30000 } = {}) {
  if (envelope?.version !== 'mkety.ctrader.cbot.v1') return { ok: false, reason: 'UNSUPPORTED_VERSION' };
  if (!envelope?.command_id || !envelope?.workspace_id || !envelope?.account_id || !envelope?.command?.action) {
    return { ok: false, reason: 'MISSING_SCOPE_OR_COMMAND' };
  }
  if (expectedAccountId != null && String(envelope.account_id) !== String(expectedAccountId)) {
    return { ok: false, reason: 'ACCOUNT_MISMATCH' };
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
