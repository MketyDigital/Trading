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

export function verifyMt5ConnectionToken(token, signingKey, nowMs = Date.now()) {
  try {
    const [version, payload, supplied, extra] = String(token ?? '').split('.');
    if (version !== 'mt5v1' || !payload || !supplied || extra) return { ok: false, reason: 'TOKEN_INVALID' };
    const expected = hmac(payload, signingKey);
    if (!safeEqual(supplied, expected)) return { ok: false, reason: 'TOKEN_INVALID' };
    const decoded = JSON.parse(fromB64url(payload));
    if (decoded?.v !== 1 || decoded?.p !== 'mt5' || !decoded?.a || !Number.isFinite(Number(decoded?.e))) return { ok: false, reason: 'TOKEN_INVALID' };
    if (Number(decoded.e) < Number(nowMs)) return { ok: false, reason: 'TOKEN_EXPIRED' };
    return { ok: true, accountRowId: String(decoded.a), expiresAt: Number(decoded.e) };
  } catch { return { ok: false, reason: 'TOKEN_INVALID' }; }
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
  const payload = b64url(JSON.stringify({ v: 1, p: 'mt5', a: String(accountRowId), e: Number(expiresAt), n: String(nonce) }));
  return `mt5v1.${payload}.${hmac(payload, signingKey)}`;
}
