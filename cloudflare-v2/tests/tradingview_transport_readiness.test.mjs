import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tradingViewTransportReadiness,
  verifyTradingViewTransport,
} from '../src/security/tradingview_transport.js';

const fingerprint = 'ab'.repeat(32);

test('tradingview transport readiness requires enabled ingress and a valid configured fingerprint', () => {
  assert.deepEqual(tradingViewTransportReadiness({}), {
    ready: false,
    directIngressEnabled: false,
    certificateConfigured: false,
    reason: 'TRADINGVIEW_DIRECT_INGRESS_DISABLED',
  });

  assert.deepEqual(tradingViewTransportReadiness({
    TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'true',
  }), {
    ready: false,
    directIngressEnabled: true,
    certificateConfigured: false,
    reason: 'TRADINGVIEW_CERTIFICATE_NOT_CONFIGURED',
  });

  assert.deepEqual(tradingViewTransportReadiness({
    TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'true',
    TRADINGVIEW_TLS_CLIENT_CERT_SHA256: fingerprint,
  }), {
    ready: true,
    directIngressEnabled: true,
    certificateConfigured: true,
    reason: null,
  });
});

test('production-capable tradingview transport path executes when development env injects enabled gates', () => {
  const env = {
    TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'true',
    TRADINGVIEW_TLS_CLIENT_CERT_SHA256: fingerprint,
  };
  const request = {
    cf: {
      tlsClientAuth: {
        certPresented: '1',
        certFingerprintSHA256: fingerprint,
      },
    },
  };

  assert.deepEqual(verifyTradingViewTransport(request, env), { ok: true });
});

test('tradingview transport still rejects an untrusted presented certificate when enabled', () => {
  const env = {
    TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'true',
    TRADINGVIEW_TLS_CLIENT_CERT_SHA256: fingerprint,
  };
  const request = {
    cf: {
      tlsClientAuth: {
        certPresented: '1',
        certFingerprintSHA256: 'cd'.repeat(32),
      },
    },
  };

  assert.deepEqual(verifyTradingViewTransport(request, env), {
    ok: false,
    reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED',
  });
});
