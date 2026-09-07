const encoder = new TextEncoder();

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function audienceMatches(tokenAudience, expectedAudience) {
  if (!expectedAudience) return true;
  const values = Array.isArray(tokenAudience) ? tokenAudience.map(String) : [String(tokenAudience ?? '')];
  const expected = Array.isArray(expectedAudience) ? expectedAudience.map(String) : [String(expectedAudience)];
  return expected.some((audience) => values.includes(audience));
}

function normalizeIssuer(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

async function importVerificationKey(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

export async function verifyMketyAccessJwt(token, {
  issuer,
  audience,
  jwks,
  jwksUrl,
  fetchFn = fetch,
  nowSec = Math.floor(Date.now() / 1000),
  clockSkewSec = 0,
  requestedWorkspaceId,
} = {}) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED_TOKEN' };

  let header;
  let claims;
  try {
    header = decodeJsonPart(parts[0]);
    claims = decodeJsonPart(parts[1]);
  } catch {
    return { ok: false, reason: 'MALFORMED_TOKEN' };
  }

  if (header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'UNSUPPORTED_JWT_HEADER' };
  if (normalizeIssuer(claims.iss) !== normalizeIssuer(issuer)) return { ok: false, reason: 'INVALID_ISSUER' };
  if (!audienceMatches(claims.aud, audience)) return { ok: false, reason: 'INVALID_AUDIENCE' };

  const now = Number(nowSec);
  const skew = Math.max(0, Number(clockSkewSec) || 0);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now - skew) return { ok: false, reason: 'TOKEN_EXPIRED' };
  if (claims.nbf != null && Number(claims.nbf) > now + skew) return { ok: false, reason: 'TOKEN_NOT_YET_VALID' };
  if (!claims.sub) return { ok: false, reason: 'MISSING_SUBJECT' };
  if (String(claims.product ?? '') !== 'trading') return { ok: false, reason: 'WRONG_PRODUCT' };
  if (!claims.workspace_id) return { ok: false, reason: 'MISSING_WORKSPACE_ASSERTION' };
  if (requestedWorkspaceId != null && String(claims.workspace_id) !== String(requestedWorkspaceId)) {
    return { ok: false, reason: 'WORKSPACE_ASSERTION_MISMATCH' };
  }
  if (String(claims.access ?? '') !== 'owner') return { ok: false, reason: 'OWNER_ACCESS_REQUIRED' };

  let keySet = jwks;
  if (!keySet && jwksUrl) {
    try {
      const response = await fetchFn(jwksUrl, { headers: { Accept: 'application/json' } });
      if (!response.ok) return { ok: false, reason: 'JWKS_FETCH_FAILED' };
      keySet = await response.json();
    } catch {
      return { ok: false, reason: 'JWKS_FETCH_FAILED' };
    }
  }

  const jwk = keySet?.keys?.find((candidate) => candidate.kid === header.kid && (!candidate.alg || candidate.alg === 'RS256'));
  if (!jwk) return { ok: false, reason: 'SIGNING_KEY_NOT_FOUND' };

  try {
    const key = await importVerificationKey(jwk);
    const signatureOk = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeBase64Url(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`)
    );
    if (!signatureOk) return { ok: false, reason: 'INVALID_SIGNATURE' };
  } catch {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }

  return {
    ok: true,
    header,
    claims,
    subject: String(claims.sub),
    workspaceId: String(claims.workspace_id),
    access: String(claims.access),
  };
}

export async function authenticateMketyAccessBearer(request, options = {}) {
  const header = request?.headers?.get?.('Authorization') || '';
  if (!header.startsWith('Bearer ')) return { ok: false, reason: 'MISSING_BEARER_TOKEN' };
  return verifyMketyAccessJwt(header.slice(7).trim(), options);
}
