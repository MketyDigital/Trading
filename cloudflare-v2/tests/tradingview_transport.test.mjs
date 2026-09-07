import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTradingViewTransport } from '../src/security/tradingview_transport.js';

function requestWithTls(tlsClientAuth) {
  return { cf: { tlsClientAuth } };
}

const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

function enabledEnv(overrides = {}) {
  return {
    TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'true',
    TRADINGVIEW_TLS_CLIENT_CERT_SHA256: FP,
    ...overrides,
  };
}

test('TradingView transport is fail-closed while direct ingress is disabled', () => {
  assert.deepEqual(
    verifyTradingViewTransport(requestWithTls({
      certPresented: '1', certVerified: 'FAILED:unable to get local issuer certificate', certFingerprintSHA256: FP,
    }), enabledEnv({ TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'false' })),
    { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' },
  );
});

test('TradingView transport requires configured certificate fingerprint allowlist', () => {
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1', certVerified: 'FAILED:unable to get local issuer certificate', certFingerprintSHA256: FP,
  }), enabledEnv({ TRADINGVIEW_TLS_CLIENT_CERT_SHA256: '' }));
  assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
});

test('TradingView transport requires a client certificate actually presented to Cloudflare', () => {
  const missing = verifyTradingViewTransport({}, enabledEnv());
  const notPresented = verifyTradingViewTransport(requestWithTls({
    certPresented: '0', certVerified: 'NONE', certFingerprintSHA256: FP,
  }), enabledEnv());

  for (const result of [missing, notPresented]) {
    assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
  }
});

test('TradingView transport accepts a pinned presented certificate even when Cloudflare cannot verify its non-Cloudflare CA', () => {
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1',
    certVerified: 'FAILED:unable to get local issuer certificate',
    certFingerprintSHA256: FP,
  }), enabledEnv());
  assert.deepEqual(result, { ok: true });
});

test('TradingView transport rejects a presented certificate with unconfigured fingerprint', () => {
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1',
    certVerified: 'FAILED:unable to get local issuer certificate',
    certFingerprintSHA256: '11'.repeat(32),
  }), enabledEnv());
  assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
});

test('TradingView transport accepts exact SHA-256 fingerprint with case separator normalization and multiple configured values', () => {
  const observed = FP.toLowerCase().replaceAll(':', '');
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1', certVerified: 'FAILED:unable to get local issuer certificate', certFingerprintSHA256: observed,
  }), enabledEnv({
    TRADINGVIEW_TLS_CLIENT_CERT_SHA256: ` ${'11'.repeat(32)} , ${FP} `,
  }));
  assert.deepEqual(result, { ok: true });
});

test('TradingView transport ignores spoofed HTTP certificate headers when request.cf has no presented certificate', () => {
  const request = {
    headers: new Headers({
      'cf-client-cert-sha256': FP,
      'x-cert-verify': 'SUCCESS',
      'x-cert-subject-dn': 'CN=webhook-server@tradingview.com',
    }),
    cf: { tlsClientAuth: { certPresented: '0', certVerified: 'NONE' } },
  };
  const result = verifyTradingViewTransport(request, enabledEnv());
  assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
});

test('TradingView transport result never exposes certificate fingerprints or metadata', () => {
  const request = requestWithTls({
    certPresented: '1',
    certVerified: 'FAILED:unable to get local issuer certificate',
    certFingerprintSHA256: '22'.repeat(32),
    certSubjectDN: 'CN=private-source-name',
    certIssuerDN: 'CN=private-issuer',
  });
  const result = verifyTradingViewTransport(request, enabledEnv());
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ['22'.repeat(16), 'private-source-name', 'private-issuer', 'fingerprint', 'subjectdn', 'issuerdn']) {
    assert.equal(serialized.includes(forbidden.toLowerCase()), false);
  }
});
