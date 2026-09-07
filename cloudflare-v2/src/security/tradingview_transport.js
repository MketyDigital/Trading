const FAILURE = Object.freeze({
  ok: false,
  reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED',
});

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function normalizeFingerprint(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function configuredFingerprints(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map(normalizeFingerprint)
      .filter(Boolean),
  );
}

export function tradingViewTransportReadiness(env = {}) {
  const directIngressEnabled = enabled(env?.TRADINGVIEW_DIRECT_INGRESS_ENABLED);
  const certificateFingerprints = configuredFingerprints(env?.TRADINGVIEW_TLS_CLIENT_CERT_SHA256);
  const certificateConfigured = certificateFingerprints.size > 0;
  const ready = directIngressEnabled && certificateConfigured;

  return {
    ready,
    directIngressEnabled,
    certificateConfigured,
    reason: ready
      ? null
      : !directIngressEnabled
        ? 'TRADINGVIEW_DIRECT_INGRESS_DISABLED'
        : 'TRADINGVIEW_CERTIFICATE_NOT_CONFIGURED',
  };
}

export function verifyTradingViewTransport(request, env = {}) {
  const readiness = tradingViewTransportReadiness(env);
  if (!readiness.ready) return FAILURE;

  const allowlist = configuredFingerprints(env?.TRADINGVIEW_TLS_CLIENT_CERT_SHA256);
  const tls = request?.cf?.tlsClientAuth;
  if (!tls || tls.certPresented !== '1') return FAILURE;

  const observed = normalizeFingerprint(tls.certFingerprintSHA256);
  if (!observed || !allowlist.has(observed)) return FAILURE;

  return { ok: true };
}
