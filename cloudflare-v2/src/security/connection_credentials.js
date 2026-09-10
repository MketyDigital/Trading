import { decryptSecret, encryptSecret } from './secret_box.js';

const ALLOWED_CREDENTIAL_KEYS = Object.freeze({
  mtproto: Object.freeze(['apiId', 'apiHash', 'session']),
  mt5: Object.freeze(['bridgeUrl', 'bridgeSecret']),
  mt5_cloud: Object.freeze(['login', 'server', 'password']),
  ctrader: Object.freeze(['clientId', 'clientSecret', 'accessToken', 'refreshToken']),
  ctrader_cbot: Object.freeze(['connectionToken', 'gatewayUrl', 'controlSecret']),
});

function normalizeCredentialValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') throw new Error('credential value is required');
  const normalized = value.trim();
  if (!normalized) throw new Error('credential value is required');
  return normalized;
}

export function validateConnectionCredentials(kind, credentials) {
  const allowed = ALLOWED_CREDENTIAL_KEYS[kind];
  if (!allowed) throw new Error('unsupported credential kind');
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    throw new Error('credentials are required');
  }

  const entries = Object.entries(credentials);
  if (entries.length === 0) throw new Error('credentials are required');

  const normalized = {};
  for (const [key, value] of entries) {
    if (!allowed.includes(key)) throw new Error(`unsupported credential key: ${key}`);
    normalized[key] = normalizeCredentialValue(value);
  }
  return normalized;
}

export async function encryptConnectionCredentials(kind, credentials, masterKey) {
  const data = validateConnectionCredentials(kind, credentials);
  return encryptSecret(JSON.stringify({ version: 1, kind, data }), masterKey);
}

export async function decryptConnectionCredentials(expectedKind, ciphertext, masterKey) {
  const plaintext = await decryptSecret(ciphertext, masterKey);
  let envelope;
  try {
    envelope = JSON.parse(plaintext);
  } catch {
    throw new Error('credential envelope is invalid');
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('credential envelope is invalid');
  }
  if (envelope.version !== 1) throw new Error('credential envelope version unsupported');
  if (envelope.kind !== expectedKind) throw new Error('credential kind mismatch');
  return validateConnectionCredentials(expectedKind, envelope.data);
}
