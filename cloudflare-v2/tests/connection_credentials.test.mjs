import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConnectionCredentials,
  encryptConnectionCredentials,
  decryptConnectionCredentials,
} from '../src/security/connection_credentials.js';

test('connection credentials validate known provider payloads', () => {
  assert.deepEqual(validateConnectionCredentials('mtproto', { apiId: 123, apiHash: ' hash ', session: ' session ' }), {
    apiId: '123', apiHash: 'hash', session: 'session',
  });
  assert.deepEqual(validateConnectionCredentials('mt5', { bridgeUrl: ' https://bridge.example ', bridgeSecret: ' secret ' }), {
    bridgeUrl: 'https://bridge.example', bridgeSecret: 'secret',
  });
  assert.deepEqual(validateConnectionCredentials('mt5_connector', { connectionToken: ' token ', gatewayUrl: ' https://gateway.example ', controlSecret: ' secret ' }), {
    connectionToken: 'token', gatewayUrl: 'https://gateway.example', controlSecret: 'secret',
  });
  assert.deepEqual(validateConnectionCredentials('ctrader', { clientId: ' id ', clientSecret: ' secret ', accessToken: ' access ', refreshToken: ' refresh ' }), {
    clientId: 'id', clientSecret: 'secret', accessToken: 'access', refreshToken: 'refresh',
  });
  assert.deepEqual(validateConnectionCredentials('ctrader_cbot', { connectionToken: ' token ', gatewayUrl: ' https://gateway.example/control ' }), {
    connectionToken: 'token', gatewayUrl: 'https://gateway.example/control',
  });
});

test('cTrader cBot credentials reject broker identity and arbitrary fields', () => {
  assert.throws(
    () => validateConnectionCredentials('ctrader_cbot', { connectionToken: 'token', accountId: 'caller-controlled' }),
    /unsupported credential key: accountId/,
  );
  assert.throws(
    () => validateConnectionCredentials('ctrader_cbot', { connectionToken: 'token', password: 'nope' }),
    /unsupported credential key: password/,
  );
});

test('MT5 connector credentials reject broker login and password fields', () => {
  assert.throws(
    () => validateConnectionCredentials('mt5_connector', { gatewayUrl: 'https://gateway.example', accountId: 'caller-controlled' }),
    /unsupported credential key: accountId/,
  );
  assert.throws(
    () => validateConnectionCredentials('mt5_connector', { gatewayUrl: 'https://gateway.example', password: 'nope' }),
    /unsupported credential key: password/,
  );
});

test('connection credential envelopes round-trip encrypted provider secrets', async () => {
  const masterKey = 'test-master-key-that-is-long-enough';
  const ciphertext = await encryptConnectionCredentials('ctrader_cbot', {
    connectionToken: 'one-time-token',
    gatewayUrl: 'https://gateway.example/control',
  }, masterKey);
  assert.notEqual(ciphertext.includes('one-time-token'), true);
  assert.deepEqual(await decryptConnectionCredentials('ctrader_cbot', ciphertext, masterKey), {
    connectionToken: 'one-time-token',
    gatewayUrl: 'https://gateway.example/control',
  });
  await assert.rejects(() => decryptConnectionCredentials('ctrader', ciphertext, masterKey), /credential kind mismatch/);
});

test('connection credentials fail closed for unknown or empty material', () => {
  assert.throws(() => validateConnectionCredentials('unknown', { token: 'x' }), /unsupported credential kind/);
  assert.throws(() => validateConnectionCredentials('mt5', {}), /credentials are required/);
  assert.throws(() => validateConnectionCredentials('mt5', { bridgeUrl: '' }), /credential value is required/);
});
