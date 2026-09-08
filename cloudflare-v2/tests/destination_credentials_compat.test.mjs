import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDestinationCredentialPlaintext } from '../src/destinations/destination_credentials_compat.js';

test('webhook credential alias secret is normalized to signingSecret', () => {
  const input = JSON.stringify({ version: 1, kind: 'destination', data: { secret: 'abc123' } });
  const output = JSON.parse(normalizeDestinationCredentialPlaintext(input));
  assert.equal(output.data.signingSecret, 'abc123');
  assert.equal(output.data.secret, undefined);
});

test('canonical destination credentials are preserved', () => {
  const input = JSON.stringify({ version: 1, kind: 'destination', data: { signingSecret: 'abc123', botToken: 'bot' } });
  const output = JSON.parse(normalizeDestinationCredentialPlaintext(input));
  assert.equal(output.data.signingSecret, 'abc123');
  assert.equal(output.data.botToken, 'bot');
});
