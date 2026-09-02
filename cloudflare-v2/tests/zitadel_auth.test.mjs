import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyZitadelJwt,
  extractZitadelRoleBindings,
  authorizeTradingClaims,
} from '../src/security/zitadel_auth.js';

function base64url(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function makeSignedJwt(claims, { kid = 'test-key' } = {}) {
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

test('cryptographically verifies RS256 token plus issuer audience exp and nbf', async () => {
  const now = 1700000000;
  const { token, jwks } = await makeSignedJwt({
    sub: 'user-1', iss: 'https://login.mkety.test', aud: ['trading-api'], exp: now + 300, nbf: now - 10,
  });
  const result = await verifyZitadelJwt(token, {
    issuer: 'https://login.mkety.test', audience: 'trading-api', jwks, nowSec: now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.claims.sub, 'user-1');
});

test('rejects wrong issuer audience expired and not-before tokens', async () => {
  const now = 1700000000;
  const base = { sub: 'u1', iss: 'https://login.mkety.test', aud: ['trading-api'], exp: now + 60, nbf: now - 1 };
  for (const [claims, options, reason] of [
    [{ ...base, iss: 'https://evil.test' }, {}, 'INVALID_ISSUER'],
    [{ ...base, aud: ['other-api'] }, {}, 'INVALID_AUDIENCE'],
    [{ ...base, exp: now - 1 }, {}, 'TOKEN_EXPIRED'],
    [{ ...base, nbf: now + 60 }, {}, 'TOKEN_NOT_YET_VALID'],
  ]) {
    const { token, jwks } = await makeSignedJwt(claims);
    const result = await verifyZitadelJwt(token, {
      issuer: 'https://login.mkety.test', audience: 'trading-api', jwks, nowSec: now, ...options,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});

test('rejects token if signature does not match selected jwk', async () => {
  const now = 1700000000;
  const signed = await makeSignedJwt({ sub: 'u1', iss: 'https://login.mkety.test', aud: 'trading-api', exp: now + 60 });
  const other = await makeSignedJwt({ sub: 'u2', iss: 'https://login.mkety.test', aud: 'trading-api', exp: now + 60 });
  other.jwks.keys[0].kid = signed.jwks.keys[0].kid;
  const result = await verifyZitadelJwt(signed.token, {
    issuer: 'https://login.mkety.test', audience: 'trading-api', jwks: other.jwks, nowSec: now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'INVALID_SIGNATURE');
});

test('extracts zitadel project-role organization bindings from documented role claim', () => {
  const claims = {
    'urn:zitadel:iam:org:project:roles': {
      trading_access: { 'org-1': 'client-one.example', 'org-2': 'client-two.example' },
      trading_admin: { 'org-1': 'client-one.example' },
    },
  };
  const bindings = extractZitadelRoleBindings(claims);
  assert.deepEqual(bindings.trading_access, ['org-1', 'org-2']);
  assert.deepEqual(bindings.trading_admin, ['org-1']);
});

test('authorizes only required role for the workspace bound zitadel organization', () => {
  const claims = {
    sub: 'user-1',
    'urn:zitadel:iam:org:project:roles': {
      trading_access: { 'org-paid': 'paid.example', 'org-other': 'other.example' },
    },
  };
  assert.deepEqual(authorizeTradingClaims(claims, {
    requiredRole: 'trading_access', workspace: { id: 'ws-1', zitadelOrgId: 'org-paid' },
  }), { ok: true, subject: 'user-1', workspaceId: 'ws-1', organizationId: 'org-paid', role: 'trading_access' });

  assert.equal(authorizeTradingClaims(claims, {
    requiredRole: 'trading_access', workspace: { id: 'ws-2', zitadelOrgId: 'org-unpaid' },
  }).reason, 'ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG');
});

test('configured Zitadel project id never falls back to a generic current-project role claim', () => {
  const claims = {
    sub: 'user-1',
    'urn:zitadel:iam:org:project:roles': {
      trading_access: { 'org-paid': 'paid.example' },
    },
  };

  const bindings = extractZitadelRoleBindings(claims, { projectId: 'trading-project' });
  assert.deepEqual(bindings, {});
  assert.equal(authorizeTradingClaims(claims, {
    projectId: 'trading-project',
    requiredRole: 'trading_access',
    workspace: { id: 'ws-1', zitadelOrgId: 'org-paid' },
  }).reason, 'ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG');
});

test('configured Zitadel project id authorizes only from its matching project-specific role claim', () => {
  const claims = {
    sub: 'user-1',
    'urn:zitadel:iam:org:project:roles': {
      trading_access: { 'org-wrong-project': 'wrong.example' },
    },
    'urn:zitadel:iam:org:project:trading-project:roles': {
      trading_access: { 'org-paid': 'paid.example' },
    },
  };

  assert.deepEqual(extractZitadelRoleBindings(claims, { projectId: 'trading-project' }), {
    trading_access: ['org-paid'],
  });
  assert.equal(authorizeTradingClaims(claims, {
    projectId: 'trading-project',
    requiredRole: 'trading_access',
    workspace: { id: 'ws-1', zitadelOrgId: 'org-paid' },
  }).ok, true);
});
