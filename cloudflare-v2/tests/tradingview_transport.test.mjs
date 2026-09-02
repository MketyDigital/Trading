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
      certPresented: '1', certVerified: 'SUCCESS', certFingerprintSHA256: FP,
    }), enabledEnv({ TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'false' })),
    { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' },
  );
});

test('TradingView transport requires configured certificate fingerprint allowlist', () => {
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1', certVerified: 'SUCCESS', certFingerprintSHA256: FP,
  }), enabledEnv({ TRADINGVIEW_TLS_CLIENT_CERT_SHA256: '' }));
  assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
});

test('TradingView transport requires Cloudflare verified presented client certificate metadata', () => {
  const missing = verifyTradingViewTransport({}, enabledEnv());
  const notPresented = verifyTradingViewTransport(requestWithTls({
    certPresented: '0', certVerified: 'SUCCESS', certFingerprintSHA256: FP,
  }), enabledEnv());
  const failed = verifyTradingViewTransport(requestWithTls({
    certPresented: '1', certVerified: 'FAILED:self signed certificate', certFingerprintSHA256: FP,
  }), enabledEnv());

  for (const result of [missing, notPresented, failed]) {
    assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
  }
});

test('TradingView transport rejects a verified certificate with unconfigured fingerprint', () => {
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1',
    certVerified: 'SUCCESS',
    certFingerprintSHA256: '11'.repeat(32),
  }), enabledEnv());
  assert.deepEqual(result, { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
});

test('TradingView transport accepts exact SHA-256 fingerprint with case separator normalization and multiple configured values', () => {
  const observed = FP.toLowerCase().replaceAll(':', '');
  const result = verifyTradingViewTransport(requestWithTls({
    certPresented: '1', certVerified: 'SUCCESS', certFingerprintSHA256: observed,
  }), enabledEnv({
    TRADINGVIEW_TLS_CLIENT_CERT_SHA256: ` ${'11'.repeat(32)} , ${FP} `,
  }));
  assert.deepEqual(result, { ok: true });
});

test('TradingView transport result never exposes certificate fingerprints or metadata', () => {
  const request = requestWithTls({
    certPresented: '1',
    certVerified: 'SUCCESS',
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
