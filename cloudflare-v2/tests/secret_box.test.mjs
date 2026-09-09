import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/security/secret_box.js';

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

test('encrypts tenant secret with random AES-GCM IV and decrypts only with master key', async () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const masterKey = base64url(key);
  const one = await encryptSecret('source-secret', masterKey);
  const two = await encryptSecret('source-secret', masterKey);
  assert.match(one, /^v1\./);
  assert.notEqual(one, two);
  assert.equal(await decryptSecret(one, masterKey), 'source-secret');

  const other = new Uint8Array(32);
  crypto.getRandomValues(other);
  await assert.rejects(() => decryptSecret(one, base64url(other)));
});

test('derives a stable AES key from an existing non-base64url master secret', async () => {
  const masterKey = 'existing-production-master-secret-value';
  const encrypted = await encryptSecret('external-mtproto-ingress-secret', masterKey);
  assert.match(encrypted, /^v1\./);
  assert.equal(await decryptSecret(encrypted, masterKey), 'external-mtproto-ingress-secret');
  await assert.rejects(() => decryptSecret(encrypted, masterKey + '-different'));
});

test('fails closed on malformed or missing encrypted values', async () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const masterKey = base64url(key);
  await assert.rejects(() => decryptSecret('plaintext-secret', masterKey), /encrypted secret/i);
  await assert.rejects(() => encryptSecret('', masterKey), /secret/i);
  await assert.rejects(() => encryptSecret('secret', ''), /master key/i);
});
