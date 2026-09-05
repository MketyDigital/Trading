import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptConnectionCredentials,
  encryptConnectionCredentials,
  validateConnectionCredentials,
} from '../src/security/connection_credentials.js';

const masterKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('MTProto credentials round-trip through a typed encrypted envelope', async () => {
  const input = { apiId: '12345', apiHash: 'hash-value', session: 'session-value' };
  const encrypted = await encryptConnectionCredentials('mtproto', input, masterKey);

  assert.match(encrypted, /^v1\./);
  assert.deepEqual(await decryptConnectionCredentials('mtproto', encrypted, masterKey), input);
  assert.equal(encrypted.includes('hash-value'), false);
  assert.equal(encrypted.includes('session-value'), false);
});

test('MT5 credentials round-trip through a typed encrypted envelope', async () => {
  const input = { bridgeUrl: 'https://bridge.example', bridgeSecret: 'bridge-secret' };
  const encrypted = await encryptConnectionCredentials('mt5', input, masterKey);
  assert.deepEqual(await decryptConnectionCredentials('mt5', encrypted, masterKey), input);
});

test('cTrader credentials round-trip through a typed encrypted envelope', async () => {
  const input = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };
  const encrypted = await encryptConnectionCredentials('ctrader', input, masterKey);
  assert.deepEqual(await decryptConnectionCredentials('ctrader', encrypted, masterKey), input);
});

test('credential validation rejects empty and unknown credential fields', () => {
  assert.throws(() => validateConnectionCredentials('mt5', {}), /credentials are required/i);
  assert.throws(
    () => validateConnectionCredentials('mt5', { bridgeUrl: 'https://bridge.example', password: 'nope' }),
    /unsupported credential key/i,
  );
});

test('decrypt rejects a credential envelope for the wrong provider kind', async () => {
  const encrypted = await encryptConnectionCredentials(
    'mt5',
    { bridgeUrl: 'https://bridge.example', bridgeSecret: 'secret' },
    masterKey,
  );

  await assert.rejects(
    () => decryptConnectionCredentials('ctrader', encrypted, masterKey),
    /credential kind mismatch/i,
  );
});

test('decrypt rejects unsupported credential envelope versions', async () => {
  const { encryptSecret } = await import('../src/security/secret_box.js');
  const encrypted = await encryptSecret(
    JSON.stringify({ version: 2, kind: 'mt5', data: { bridgeUrl: 'https://bridge.example' } }),
    masterKey,
  );

  await assert.rejects(
    () => decryptConnectionCredentials('mt5', encrypted, masterKey),
    /credential envelope version/i,
  );
});
