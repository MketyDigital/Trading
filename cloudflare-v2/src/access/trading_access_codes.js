import { normalizeTradingEntitlements } from '../security/trading_entitlements.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const REFRESH_COOKIE_NAME = 'mkety_trading_refresh';

function base64UrlEncode(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(decoder.decode(base64UrlDecode(value)));
}

async function importHmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret ?? '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

async function signHmac(value, secret) {
  const key = await importHmacKey(secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return new Uint8Array(signature);
}

async function verifyHmac(value, signature, secret) {
  const key = await importHmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(value));
}

async function createSignedToken(header, claims, secret) {
  const encodedHeader = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const encodedClaims = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = await signHmac(signingInput, secret);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function verifySignedToken(token, secret, expected = {}) {
  if (!secret) return { ok: false, reason: 'TOKEN_SECRET_NOT_CONFIGURED' };
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED_TOKEN' };

  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: 'MALFORMED_TOKEN' };
  }

  if (expected.alg && header.alg !== expected.alg) return { ok: false, reason: 'UNSUPPORTED_TOKEN' };
  if (expected.kid && header.kid !== expected.kid) return { ok: false, reason: 'UNSUPPORTED_TOKEN' };

  let signatureOk = false;
  try {
    signatureOk = await verifyHmac(`${parts[0]}.${parts[1]}`, base64UrlDecode(parts[2]), secret);
  } catch {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
  if (!signatureOk) return { ok: false, reason: 'INVALID_SIGNATURE' };

  return { ok: true, header, claims };
}

export function normalizeTradingAccessCode(code) {
  return String(code ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .toUpperCase();
}

export async function hashTradingAccessCode(code) {
  const normalizedCode = normalizeTradingAccessCode(code);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalizedCode));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateTradingAccessCodeCredentialRecord(record, now = new Date()) {
  if (!record) return { ok: false, status: 404, reason: 'ACCESS_CODE_NOT_FOUND' };
  if (String(record.product ?? '') !== 'trading') {
    return { ok: false, status: 403, reason: 'ACCESS_CODE_WRONG_PRODUCT' };
  }
  if (String(record.status ?? '') !== 'active') {
    return { ok: false, status: 403, reason: 'ACCESS_CODE_NOT_ACTIVE' };
  }
  if (record.expires_at && new Date(record.expires_at).getTime() <= new Date(now).getTime()) {
    return { ok: false, status: 403, reason: 'ACCESS_CODE_EXPIRED' };
  }
  if (String(record.role ?? 'owner') !== 'owner') {
    return { ok: false, status: 403, reason: 'ACCESS_CODE_OWNER_ROLE_REQUIRED' };
  }
  const workspaceId = String(record.workspace_id ?? '').trim();
  if (!workspaceId) return { ok: false, status: 422, reason: 'ACCESS_CODE_WORKSPACE_REQUIRED' };

  const ownerEmail = String(record.owner_email ?? '').trim().toLowerCase();
  const subject = ownerEmail ? `access-code:${ownerEmail}` : `access-code:${record.id}`;
  return {
    ok: true,
    codeId: String(record.id),
    workspace: {
      id: workspaceId,
      name: record.workspace_display_name ?? null,
      owner_email: ownerEmail || null,
    },
    membership: {
      subject,
      role: 'owner',
      enabled: true,
    },
    entitlements: normalizeTradingEntitlements(record.entitlements),
  };
}

export function validateTradingAccessCodeRecord(record, now = new Date()) {
  const plan = validateTradingAccessCodeCredentialRecord(record, now);
  if (!plan.ok) return plan;
  const maxRedemptions = Math.max(1, Number.parseInt(record.max_redemptions ?? 1, 10) || 1);
  const redeemedCount = Math.max(0, Number.parseInt(record.redeemed_count ?? 0, 10) || 0);
  if (redeemedCount >= maxRedemptions) {
    return { ok: false, status: 409, reason: 'ACCESS_CODE_REDEMPTION_LIMIT_REACHED' };
  }
  return plan;
}

export function classifyTradingAccessCodeUse(record, ownerEmail, now = new Date()) {
  const plan = validateTradingAccessCodeCredentialRecord(record, now);
  if (!plan.ok) return plan;

  const suppliedEmail = String(ownerEmail ?? '').trim().toLowerCase();
  const boundEmail = String(record.owner_email ?? '').trim().toLowerCase();
  if (!suppliedEmail || !suppliedEmail.includes('@')) {
    return { ok: false, status: 400, reason: 'OWNER_EMAIL_REQUIRED' };
  }
  if (boundEmail && suppliedEmail !== boundEmail) {
    return { ok: false, status: 403, reason: 'ACCESS_CODE_OWNER_EMAIL_MISMATCH' };
  }

  const maxRedemptions = Math.max(1, Number.parseInt(record.max_redemptions ?? 1, 10) || 1);
  const redeemedCount = Math.max(0, Number.parseInt(record.redeemed_count ?? 0, 10) || 0);
  return {
    ...plan,
    mode: redeemedCount >= maxRedemptions ? 'access_code_login' : 'access_code_onboarding',
  };
}

export async function createLocalTradingBearer(payload = {}, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('TRADING_ACCESS_CODE_SESSION_SECRET_REQUIRED');
  const workspaceId = String(payload.workspaceId ?? '').trim();
  const subject = String(payload.subject ?? '').trim();
  if (!workspaceId) throw new Error('WORKSPACE_REQUIRED');
  if (!subject) throw new Error('SUBJECT_REQUIRED');

  const header = { alg: 'HS256', typ: 'JWT', kid: 'trading-access-code-v1' };
  const claims = {
    iss: 'mkety-trading-access-code',
    aud: 'mkety-trading-local',
    product: 'trading',
    workspace_id: workspaceId,
    sub: subject,
    access: String(payload.access ?? 'owner'),
    iat: Number(nowSec),
    exp: Number(nowSec) + Math.max(60, Number(payload.ttlSec ?? 900) || 900),
  };
  return createSignedToken(header, claims, secret);
}

export async function verifyLocalTradingBearer(token, secret, {
  requestedWorkspaceId,
  nowSec = Math.floor(Date.now() / 1000),
  clockSkewSec = 0,
} = {}) {
  if (!secret) return { ok: false, reason: 'LOCAL_TRADING_BEARER_NOT_CONFIGURED' };
  const verified = await verifySignedToken(token, secret, { alg: 'HS256', kid: 'trading-access-code-v1' });
  if (!verified.ok) return verified;
  const { header, claims } = verified;

  const now = Number(nowSec);
  const skew = Math.max(0, Number(clockSkewSec) || 0);
  if (claims.iss !== 'mkety-trading-access-code') return { ok: false, reason: 'INVALID_ISSUER' };
  if (claims.aud !== 'mkety-trading-local') return { ok: false, reason: 'INVALID_AUDIENCE' };
  if (claims.product !== 'trading') return { ok: false, reason: 'WRONG_PRODUCT' };
  if (!claims.sub) return { ok: false, reason: 'MISSING_SUBJECT' };
  if (!claims.workspace_id) return { ok: false, reason: 'MISSING_WORKSPACE_ASSERTION' };
  if (Number(claims.exp) <= now - skew) return { ok: false, reason: 'TOKEN_EXPIRED' };
  if (requestedWorkspaceId != null && String(claims.workspace_id) !== String(requestedWorkspaceId)) {
    return { ok: false, reason: 'WORKSPACE_ASSERTION_MISMATCH' };
  }
  if (claims.access !== 'owner') return { ok: false, reason: 'OWNER_ACCESS_REQUIRED' };

  return {
    ok: true,
    header,
    claims,
    subject: String(claims.sub),
    workspaceId: String(claims.workspace_id),
    access: String(claims.access),
  };
}

export async function createTradingRefreshToken(payload = {}, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('TRADING_ACCESS_CODE_SESSION_SECRET_REQUIRED');
  const workspaceId = String(payload.workspaceId ?? '').trim();
  const subject = String(payload.subject ?? '').trim();
  if (!workspaceId) throw new Error('WORKSPACE_REQUIRED');
  if (!subject) throw new Error('SUBJECT_REQUIRED');
  const ttlSec = Math.max(3600, Number(payload.ttlSec ?? 30 * 24 * 60 * 60) || 30 * 24 * 60 * 60);
  return createSignedToken(
    { alg: 'HS256', typ: 'JWT', kid: 'trading-refresh-v1' },
    {
      iss: 'mkety-trading-refresh',
      aud: 'mkety-trading-browser',
      product: 'trading',
      workspace_id: workspaceId,
      sub: subject,
      access: 'owner',
      iat: Number(nowSec),
      exp: Number(nowSec) + ttlSec,
    },
    secret,
  );
}

export async function verifyTradingRefreshToken(token, secret, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const verified = await verifySignedToken(token, secret, { alg: 'HS256', kid: 'trading-refresh-v1' });
  if (!verified.ok) return verified;
  const { claims } = verified;
  if (claims.iss !== 'mkety-trading-refresh') return { ok: false, reason: 'INVALID_ISSUER' };
  if (claims.aud !== 'mkety-trading-browser') return { ok: false, reason: 'INVALID_AUDIENCE' };
  if (claims.product !== 'trading') return { ok: false, reason: 'WRONG_PRODUCT' };
  if (!claims.sub || !claims.workspace_id) return { ok: false, reason: 'INVALID_REFRESH_SUBJECT' };
  if (Number(claims.exp) <= Number(nowSec)) return { ok: false, reason: 'TOKEN_EXPIRED' };
  if (claims.access !== 'owner') return { ok: false, reason: 'OWNER_ACCESS_REQUIRED' };
  return {
    ok: true,
    subject: String(claims.sub),
    workspaceId: String(claims.workspace_id),
    claims,
  };
}

export function tradingRefreshCookie(token, { maxAgeSec = 30 * 24 * 60 * 60 } = {}) {
  return `${REFRESH_COOKIE_NAME}=${String(token || '')}; Path=/; Max-Age=${Math.max(0, Number(maxAgeSec) || 0)}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearTradingRefreshCookie() {
  return `${REFRESH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function readTradingRefreshCookie(request) {
  const cookie = String(request?.headers?.get?.('Cookie') || '');
  const prefix = `${REFRESH_COOKIE_NAME}=`;
  for (const part of cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return '';
}

export async function authenticateLocalTradingAccessBearer(request, env = {}, options = {}) {
  const header = request?.headers?.get?.('Authorization') || '';
  if (!header.startsWith('Bearer ')) return { ok: false, reason: 'MISSING_BEARER_TOKEN' };
  return verifyLocalTradingBearer(header.slice(7).trim(), env.TRADING_ACCESS_CODE_SESSION_SECRET, options);
}