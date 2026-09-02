import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTradingViewWebhookRequest } from '../src/http/tradingview_webhook.js';

const URL = 'https://trading.example.com/api/v1/webhooks/tradingview/tv_public_abc123';
const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

function request(body, { method = 'POST', headers = {}, cf } = {}) {
  const req = new Request(URL, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? body : undefined,
  });
  if (cf !== undefined) Object.defineProperty(req, 'cf', { value: cf, configurable: true });
  return req;
}

function validBody(overrides = {}) {
  return JSON.stringify({
    event_id: 'alert-100',
    occurred_at: '2026-09-02T18:00:00.000Z',
    text: 'BUY XAUUSD NOW SL 2500 TP 2520',
    structured_payload: { strategy: 'alpha' },
    metadata: { origin: 'tradingview' },
    ...overrides,
  });
}

function deps(overrides = {}) {
  const state = { lookups: [], queued: [] };
  const source = {
    id: 'tv-source-a',
    workspaceId: 'ws-private-a',
    providerType: 'tradingview_webhook',
    sourceFamily: 'tradingview',
    externalIdentity: 'strategy-a',
  };
  return {
    state,
    options: {
      verifyTransport: () => ({ ok: true }),
      sourceStore: {
        async getActiveTradingViewSourceByPublicHandle(handle) {
          state.lookups.push(handle);
          return source;
        },
      },
      sourceQueue: {
        async enqueueSourceEvent(resolvedSource, event) {
          state.queued.push([resolvedSource, event]);
          return { queued: true };
        },
      },
      nowMs: () => Date.parse('2026-09-02T18:22:00.000Z'),
      ...overrides,
    },
  };
}

async function json(response) {
  return response.json();
}

test('TradingView webhook is POST-only before transport/source work', async () => {
  let verifies = 0;
  const { options, state } = deps({ verifyTransport: () => { verifies += 1; return { ok: true }; } });
  const response = await handleTradingViewWebhookRequest(request(null, { method: 'GET' }), {}, options);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'POST');
  assert.equal(verifies, 0);
  assert.equal(state.lookups.length, 0);
});

test('failed TradingView transport verification stops before source lookup and queue', async () => {
  const { options, state } = deps({
    verifyTransport: () => ({ ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' }),
  });
  const response = await handleTradingViewWebhookRequest(request(validBody()), {}, options);
  assert.equal(response.status, 403);
  assert.deepEqual(await json(response), { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' });
  assert.equal(state.lookups.length, 0);
  assert.equal(state.queued.length, 0);
});

test('certificate probe is silent by default when normal ingress is disabled', async () => {
  const observations = [];
  const { options, state } = deps({
    verifyTransport: () => ({ ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' }),
    probeLogger: (entry) => observations.push(entry),
  });
  const response = await handleTradingViewWebhookRequest(request(validBody(), {
    cf: { tlsClientAuth: { certPresented: '1', certFingerprintSHA256: FP } },
  }), { TRADINGVIEW_CERT_PROBE_ENABLED: 'false' }, options);

  assert.equal(response.status, 403);
  assert.deepEqual(observations, []);
  assert.equal(state.lookups.length, 0);
  assert.equal(state.queued.length, 0);
});

test('certificate probe records only sanitized presentation state when no client certificate is present', async () => {
  const observations = [];
  const { options, state } = deps({
    verifyTransport: () => ({ ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' }),
    probeLogger: (entry) => observations.push(entry),
  });
  const response = await handleTradingViewWebhookRequest(request(validBody(), {
    headers: { 'cf-client-cert-sha256': FP, 'x-cert-subject-dn': 'CN=spoofed' },
    cf: { tlsClientAuth: { certPresented: '0', certFingerprintSHA256: FP } },
  }), { TRADINGVIEW_CERT_PROBE_ENABLED: 'true' }, options);

  assert.equal(response.status, 403);
  assert.deepEqual(observations, [{
    event: 'TRADINGVIEW_CERT_PROBE',
    certPresented: false,
    fingerprintAvailable: false,
    certFingerprintSHA256: null,
  }]);
  assert.equal(state.lookups.length, 0);
  assert.equal(state.queued.length, 0);
});

test('certificate probe records exact normalized Cloudflare-observed fingerprint but never authorizes ingress', async () => {
  const observations = [];
  const { options, state } = deps({
    verifyTransport: () => ({ ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' }),
    probeLogger: (entry) => observations.push(entry),
  });
  const response = await handleTradingViewWebhookRequest(request(validBody(), {
    headers: {
      'cf-client-cert-sha256': '11'.repeat(32),
      'x-cert-subject-dn': 'CN=spoofed',
      'authorization': 'Bearer private',
    },
    cf: {
      tlsClientAuth: {
        certPresented: '1',
        certVerified: 'FAILED:unable to get local issuer certificate',
        certFingerprintSHA256: FP,
        certSubjectDN: 'CN=private-subject',
        certIssuerDN: 'CN=private-issuer',
      },
    },
  }), {
    TRADINGVIEW_CERT_PROBE_ENABLED: 'true',
    TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'false',
  }, options);

  assert.equal(response.status, 403);
  assert.deepEqual(observations, [{
    event: 'TRADINGVIEW_CERT_PROBE',
    certPresented: true,
    fingerprintAvailable: true,
    certFingerprintSHA256: FP.toLowerCase().replaceAll(':', ''),
  }]);
  const serialized = JSON.stringify(observations);
  for (const forbidden of ['private-subject', 'private-issuer', 'Bearer private', 'spoofed', '11'.repeat(32)]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(state.lookups.length, 0);
  assert.equal(state.queued.length, 0);
});

test('unknown or inactive public handle fails closed without queueing', async () => {
  const { options, state } = deps({
    sourceStore: { async getActiveTradingViewSourceByPublicHandle(handle) { state.lookups.push(handle); return null; } },
  });
  const response = await handleTradingViewWebhookRequest(request(validBody()), {}, options);
  assert.equal(response.status, 404);
  assert.deepEqual(state.lookups, ['tv_public_abc123']);
  assert.equal(state.queued.length, 0);
});

test('malformed or incomplete TradingView alert fails before queue handoff', async () => {
  for (const body of [
    '{bad-json',
    validBody({ event_id: '' }),
    JSON.stringify({ event_id: 'event-no-content', text: '', structured_payload: {} }),
  ]) {
    const { options, state } = deps();
    const response = await handleTradingViewWebhookRequest(request(body), {}, options);
    assert.equal(response.status, 400);
    assert.equal(state.queued.length, 0);
  }
});

test('oversized TradingView request returns 413 without queueing', async () => {
  const { options, state } = deps({ maxBodyBytes: 32 });
  const response = await handleTradingViewWebhookRequest(request(validBody()), {}, options);
  assert.equal(response.status, 413);
  assert.equal(state.queued.length, 0);
});

test('valid TradingView alert queues once using stable native identity and strips caller authority recursively', async () => {
  const { options, state } = deps();
  const response = await handleTradingViewWebhookRequest(request(validBody({
    workspace_id: 'attacker-workspace',
    source_connection_id: 'attacker-source',
    destination_id: 'broker-a',
    execution_enabled: true,
    metadata: {
      origin: 'tradingview',
      nested: {
        workspace_id: 'attacker-workspace',
        broker_id: 'broker-a',
        api_token: 'private-token',
        safe_note: 'keep-me',
      },
    },
    structured_payload: {
      strategy: 'alpha',
      destination: 'broker-b',
      nested: { password: 'private-password', signal: 'BUY' },
    },
  })), {}, options);

  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), { ok: true, queued: true });
  assert.deepEqual(state.lookups, ['tv_public_abc123']);
  assert.equal(state.queued.length, 1);

  const [source, event] = state.queued[0];
  assert.equal(source.id, 'tv-source-a');
  assert.equal(event.external_event_id, 'alert-100');
  assert.equal(event.occurred_at, '2026-09-02T18:00:00.000Z');
  assert.equal(event.metadata.native_identity.event_id, 'alert-100');
  assert.equal(event.metadata.origin, 'tradingview');
  assert.equal(event.metadata.nested.safe_note, 'keep-me');
  assert.equal(event.structured_payload.nested.signal, 'BUY');

  const serialized = JSON.stringify(event).toLowerCase();
  for (const forbidden of [
    'attacker-workspace', 'attacker-source', 'broker-a', 'broker-b',
    'private-token', 'private-password', 'execution_enabled', 'workspace_id',
    'source_connection_id', 'destination_id', 'api_token', 'password',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  const responseText = JSON.stringify(await (new Response(JSON.stringify({ ok: true, queued: true }))).json());
  assert.equal(responseText.includes('ws-private-a'), false);
  assert.equal(responseText.includes('tv-source-a'), false);
});

test('missing occurred_at uses server receive time without changing stable event id', async () => {
  const { options, state } = deps();
  const response = await handleTradingViewWebhookRequest(request(validBody({ occurred_at: undefined })), {}, options);
  assert.equal(response.status, 202);
  assert.equal(state.queued[0][1].external_event_id, 'alert-100');
  assert.equal(state.queued[0][1].occurred_at, '2026-09-02T18:22:00.000Z');
});

test('TradingView queue failure is request-local 503 and never claims acceptance', async () => {
  const { options, state } = deps({
    sourceQueue: {
      async enqueueSourceEvent() {
        throw new Error('private queue failure with source secret');
      },
    },
  });
  const response = await handleTradingViewWebhookRequest(request(validBody()), {}, options);
  assert.equal(response.status, 503);
  const body = await json(response);
  assert.deepEqual(body, { ok: false, reason: 'TRADINGVIEW_QUEUE_UNAVAILABLE' });
  assert.equal(JSON.stringify(body).includes('private queue failure'), false);
  assert.equal(state.lookups.length, 1);
});
