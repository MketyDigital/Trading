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

test('enterprise portal filters child controls using safe workspace entitlements', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  const html = await response.text();
  assert.match(html, /applyEntitlementsToFrame/);
  assert.match(html, /telegramDestination/);
  assert.match(html, /tradingExecutionDestination/);
  assert.match(html, /customHostname/);
  assert.match(html, /destinationType/);
  assert.match(html, /data-tab=["']hostnames["']/);
});

test('staff access-code manager remains isolated from enterprise customer session', async () => {
  const response = await worker().fetch(new Request('https://trade.mkety.com/mkety-admin/access-codes'), {}, {});
  const html = await response.text();
  assert.match(html, /Mkety Staff Access Codes/);
  assert.doesNotMatch(html, /mketyTradingBearer/);
});
