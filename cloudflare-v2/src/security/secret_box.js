const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decodeBase64Url(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importMasterKey(masterKey) {
  const raw = decodeBase64Url(masterKey);
  if (raw.length !== 32) throw new TypeError('master key must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(secret, masterKey) {
  if (!String(secret ?? '')) throw new TypeError('secret is required');
  const key = await importMasterKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(String(secret)));
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(encryptedSecret, masterKey) {
  const parts = String(encryptedSecret ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new TypeError('encrypted secret must use v1 envelope format');
  const iv = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  if (iv.length !== 12 || ciphertext.length < 17) throw new TypeError('encrypted secret is malformed');
  const key = await importMasterKey(masterKey);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return decoder.decode(plaintext);
}
