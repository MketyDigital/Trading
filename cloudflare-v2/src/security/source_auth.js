const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function importKey(secret) {
  if (!secret) throw new TypeError('source secret required');
  return crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function signSourcePayload(rawBody, timestamp, secret) {
  const key = await importKey(secret);
  const basis = `v1:${timestamp}:${rawBody}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(basis));
  return `v1=${toHex(signature)}`;
}

export async function verifySignedSourcePayload({
  rawBody,
  sourceId,
  timestamp,
  signature,
  secret,
  nowMs = Date.now(),
  maxSkewMs = 30000,
} = {}) {
  if (!sourceId || !timestamp || !signature) return { ok: false, reason: 'MISSING_AUTH_FIELDS' };
  const ts = Number(timestamp);
  const now = Number(nowMs);
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return { ok: false, reason: 'INVALID_TIMESTAMP' };
  if (ts < now - Number(maxSkewMs)) return { ok: false, reason: 'STALE_TIMESTAMP' };
  if (ts > now + Number(maxSkewMs)) return { ok: false, reason: 'FUTURE_TIMESTAMP' };

  let expected;
  try {
    expected = await signSourcePayload(String(rawBody ?? ''), String(timestamp), secret);
  } catch {
    return { ok: false, reason: 'SIGNATURE_ERROR' };
  }
  if (!constantTimeEqual(expected, signature)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  return { ok: true, sourceId: String(sourceId) };
}
