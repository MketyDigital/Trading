import crypto from 'node:crypto';

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function fromB64url(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function hmac(value, secret) {
  if (!secret) throw new Error('signing key required');
  return crypto.createHmac('sha256', String(secret)).update(value).digest('base64url');
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createMt5AuthToken({ accountRowId, expiresAt, nonce = crypto.randomUUID(), purpose = 'pair', connectorInstanceId = null }, signingKey) {
  const id = String(accountRowId ?? '').trim();
  const expiry = Number(expiresAt);
  const kind = String(purpose || '').trim().toLowerCase();
  const instanceId = connectorInstanceId == null ? null : String(connectorInstanceId).trim();
  if (!id || !Number.isFinite(expiry) || !['pair', 'reconnect'].includes(kind)) throw new TypeError('valid MT5 token scope required');
  if (kind === 'reconnect' && !instanceId) throw new TypeError('connectorInstanceId required for reconnect token');
  const prefix = kind === 'reconnect' ? 'mt5r1' : 'mt5v1';
  const payload = b64url(JSON.stringify({
    v: 1,
    p: 'mt5',
    k: kind,
    a: id,
    e: expiry,
    n: String(nonce),
    ...(instanceId ? { i: instanceId } : {}),
  }));
  return `${prefix}.${payload}.${hmac(payload, signingKey)}`;
}

export function verifyMt5ConnectionToken(token, signingKey, nowMs = Date.now()) {
  try {
    const [version, payload, supplied, extra] = String(token ?? '').split('.');
    if (!['mt5v1', 'mt5r1'].includes(version) || !payload || !supplied || extra) return { ok: false, reason: 'TOKEN_INVALID' };
    const expected = hmac(payload, signingKey);
    if (!safeEqual(supplied, expected)) return { ok: false, reason: 'TOKEN_INVALID' };
    const decoded = JSON.parse(fromB64url(payload));
    const purpose = String(decoded?.k || (version === 'mt5r1' ? 'reconnect' : 'pair')).toLowerCase();
    if (decoded?.v !== 1 || decoded?.p !== 'mt5' || !decoded?.a || !Number.isFinite(Number(decoded?.e)) || !['pair', 'reconnect'].includes(purpose)) {
      return { ok: false, reason: 'TOKEN_INVALID' };
    }
    if ((purpose === 'pair' && version !== 'mt5v1') || (purpose === 'reconnect' && version !== 'mt5r1')) return { ok: false, reason: 'TOKEN_INVALID' };
    const connectorInstanceId = decoded?.i == null ? null : String(decoded.i).trim();
    if (purpose === 'reconnect' && !connectorInstanceId) return { ok: false, reason: 'TOKEN_INVALID' };
    if (Number(decoded.e) < Number(nowMs)) return { ok: false, reason: 'TOKEN_EXPIRED' };
    return {
      ok: true,
      accountRowId: String(decoded.a),
      expiresAt: Number(decoded.e),
      purpose,
      connectorInstanceId,
    };
  } catch { return { ok: false, reason: 'TOKEN_INVALID' }; }
}

export function createMt5ReconnectToken({ accountRowId, connectorInstanceId, expiresAt, nonce = crypto.randomUUID() }, signingKey) {
  return createMt5AuthToken({ accountRowId, connectorInstanceId, expiresAt, nonce, purpose: 'reconnect' }, signingKey);
}

export function validateMt5Command(envelope, expectedAccountId, nowMs = Date.now()) {
  if (envelope?.version !== 'mkety.mt5.connector.v1' || !envelope?.command_id || !envelope?.account_id || !envelope?.broker_account_id || !envelope?.command?.action) {
    return { ok: false, reason: 'COMMAND_INVALID' };
  }
  if (String(envelope.account_id) !== String(expectedAccountId)) return { ok: false, reason: 'ACCOUNT_MISMATCH' };
  const issuedAt = Number(envelope.issued_at);
  const expiresAt = Number(envelope.expires_at);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt) return { ok: false, reason: 'COMMAND_INVALID' };
  if (expiresAt < Number(nowMs)) return { ok: false, reason: 'EXPIRED' };
  return { ok: true };
}

export function createMt5TokenForTest({ accountRowId, expiresAt, nonce = 'test' }, signingKey) {
  return createMt5AuthToken({ accountRowId, expiresAt, nonce, purpose: 'pair' }, signingKey);
}
