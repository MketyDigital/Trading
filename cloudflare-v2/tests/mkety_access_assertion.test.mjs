import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateMketyAccessBearer, verifyMketyAccessJwt } from '../src/security/mkety_access_assertion.js';

function base64url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function makeSignedJwt(claims, { kid = 'mkety-test-key' } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${base64url(new Uint8Array(signature))}`, jwks: { keys: [jwk] } };
}

function ownerClaims(now = 1700000000, overrides = {}) {
  return {
    sub: 'user-123',
    iss: 'https://access.mkety.test',
    aud: 'mkety-trading',
    exp: now + 300,
    iat: now,
    jti: 'assertion-1',
    product: 'trading',
    workspace_id: 'ws-starpips',
    access: 'owner',
    ...overrides,
  };
}

test('verifies Mkety RS256 assertion and returns the Trading owner identity contract', async () => {
  const now = 1700000000;
  const { token, jwks } = await makeSignedJwt(ownerClaims(now));
  const result = await verifyMketyAccessJwt(token, {
    issuer: 'https://access.mkety.test', audience: 'mkety-trading', jwks, nowSec: now,
    requestedWorkspaceId: 'ws-starpips',
  });

  assert.equal(result.ok, true);
  assert.equal(result.subject, 'user-123');
  assert.equal(result.workspaceId, 'ws-starpips');
  assert.equal(result.access, 'owner');
  assert.equal(result.claims.product, 'trading');
});

test('fails closed for wrong product, workspace or access', async () => {
  const now = 1700000000;
  for (const [overrides, reason] of [
    [{ product: 'mksaas' }, 'WRONG_PRODUCT'],
    [{ workspace_id: 'ws-other' }, 'WORKSPACE_ASSERTION_MISMATCH'],
    [{ access: 'viewer' }, 'OWNER_ACCESS_REQUIRED'],
  ]) {
    const { token, jwks } = await makeSignedJwt(ownerClaims(now, overrides));
    const result = await verifyMketyAccessJwt(token, {
      issuer: 'https://access.mkety.test', audience: 'mkety-trading', jwks, nowSec: now,
      requestedWorkspaceId: 'ws-starpips',
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});

test('fails closed for wrong issuer/audience, expiry and invalid signature', async () => {
  const now = 1700000000;
  for (const [overrides, options, reason] of [
    [{ iss: 'https://evil.test' }, {}, 'INVALID_ISSUER'],
    [{ aud: 'other-product' }, {}, 'INVALID_AUDIENCE'],
    [{ exp: now - 1 }, {}, 'TOKEN_EXPIRED'],
  ]) {
    const { token, jwks } = await makeSignedJwt(ownerClaims(now, overrides));
    const result = await verifyMketyAccessJwt(token, {
      issuer: 'https://access.mkety.test', audience: 'mkety-trading', jwks, nowSec: now,
      requestedWorkspaceId: 'ws-starpips', ...options,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }

  const signed = await makeSignedJwt(ownerClaims(now));
  const other = await makeSignedJwt(ownerClaims(now, { sub: 'other-user' }));
  other.jwks.keys[0].kid = signed.jwks.keys[0].kid;
  const invalidSignature = await verifyMketyAccessJwt(signed.token, {
    issuer: 'https://access.mkety.test', audience: 'mkety-trading', jwks: other.jwks, nowSec: now,
    requestedWorkspaceId: 'ws-starpips',
  });
  assert.equal(invalidSignature.ok, false);
  assert.equal(invalidSignature.reason, 'INVALID_SIGNATURE');
});

test('bearer helper requires authorization header and binds requested workspace', async () => {
  const missing = await authenticateMketyAccessBearer(new Request('https://trade.test/api/v1/admin/workspace'), {
    issuer: 'https://access.mkety.test', audience: 'mkety-trading', jwks: { keys: [] }, requestedWorkspaceId: 'ws-starpips',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'MISSING_BEARER_TOKEN');

  const now = 1700000000;
  const { token, jwks } = await makeSignedJwt(ownerClaims(now));
  const allowed = await authenticateMketyAccessBearer(new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { Authorization: `Bearer ${token}` },
  }), {
    issuer: 'https://access.mkety.test', audience: 'mkety-trading', jwks, nowSec: now,
    requestedWorkspaceId: 'ws-starpips',
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.subject, 'user-123');
});
