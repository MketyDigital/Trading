import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

const legacy = {
  async fetch() {
    return new Response('<html><body>legacy dashboard</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
  },
};

function worker() {
  return createTradingV1Entrypoint({ legacy });
}

test('trade.mkety.com root is the single enterprise customer entry point', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Mkety Trading/i);
  assert.match(html, /Access code/i);
  assert.match(html, /ownerEmail/);
  assert.match(html, /\/api\/v1\/access\/redeem/);
  assert.doesNotMatch(html, /paste.*bearer/i);
  assert.doesNotMatch(html, /Workspace ID is required/i);
});

test('enterprise entry persists one shared tenant session after access-code redemption', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.match(html, /mketyTradingWorkspace/);
  assert.match(html, /mketyTradingBearer/);
  assert.match(html, /mketyTradingEntitlements/);
  assert.match(html, /sessionStorage/);
});

test('enterprise customer experience is one console, not embedded duplicate consoles', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /workspace-console\?embedded/i);
  assert.doesNotMatch(html, /launch-console\?embedded/i);
  assert.match(html, /data-view="overview"/);
  assert.match(html, /data-view="connections"/);
  assert.match(html, /data-view="routing"/);
  assert.match(html, /data-view="ai"/);
  assert.match(html, /data-view="branding"/);
  assert.match(html, /data-view="operations"/);
});

test('enterprise console hides deployment internals and raw config-first UX', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.doesNotMatch(html, /Deployment-owned security\/runtime settings are intentionally read-only/i);
  assert.doesNotMatch(html, /Credentials JSON/i);
  assert.doesNotMatch(html, /Config file/i);
  assert.match(html, /Broker connection/i);
  assert.match(html, /AI provider/i);
  assert.match(html, /Custom domain/i);
});

test('enterprise portal filters controls using safe workspace entitlements', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.match(html, /telegramDestination/);
  assert.match(html, /tradingExecutionDestination/);
  assert.match(html, /customHostname/);
  assert.match(html, /applyEntitlements/);
});

test('root portal bootstraps public white-label branding before authentication', async () => {
  const response = await worker().fetch(new Request('https://trade.customer.example/'), {
    TRADING_ACCESS_ENABLED: 'true',
    TRADING_CUSTOM_HOSTNAMES_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.match(html, /\/api\/v1\/public\/branding/);
  assert.match(html, /applyBranding/);
  assert.match(html, /DOMContentLoaded|loadPublicBranding/);
});

test('staff access-code manager remains isolated from enterprise customer session', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/mkety-admin/access-codes'), {}, {});
  const html = await response.text();
  assert.match(html, /Mkety Staff Access Codes/);
  assert.doesNotMatch(html, /mketyTradingBearer/);
});
