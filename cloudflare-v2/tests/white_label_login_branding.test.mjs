import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingV1Entrypoint } from '../src/v1_entry.js';

const env = {
  TRADING_ACCESS_ENABLED: 'true',
  TRADING_CUSTOM_HOSTNAMES_ENABLED: 'true',
  TRADING_CANONICAL_HOSTS: 'trade.mkety.com',
};

function brandingHandler(request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === 'copier.starpipsforex.com') {
    return new Response(JSON.stringify({
      ok: true,
      kind: 'white_label',
      workspaceId: 'ws-starpips',
      branding: {
        brandName: 'Starpips Forex',
        productName: 'Trade Copier',
        logoUrl: 'https://cdn.example.test/starpips.png',
        accentColor: '#022474',
        hideMketyBranding: true,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true, kind: 'canonical', branding: { brandName: 'Mkety', productName: 'Trading' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('active custom hostname renders saved white-label branding before any browser JavaScript runs', async () => {
  const worker = createTradingV1Entrypoint({ publicBrandingHandler: brandingHandler });
  const response = await worker.fetch(new Request('https://copier.starpipsforex.com/'), env, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Starpips Forex Trade Copier<\/title>/);
  assert.match(html, /<h1 id="brandTitle">Starpips Forex Trade Copier<\/h1>/);
  assert.match(html, /src="https:\/\/cdn\.example\.test\/starpips\.png"/);
  assert.match(html, /--accent:#022474/i);
  assert.doesNotMatch(html, /<title>Mkety Trading<\/title>/);
});

test('canonical trade.mkety.com keeps Mkety Trading initial branding', async () => {
  const worker = createTradingV1Entrypoint({ publicBrandingHandler: brandingHandler });
  const response = await worker.fetch(new Request('https://trade.mkety.com/'), env, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Mkety Trading<\/title>/);
  assert.match(html, /<h1 id="brandTitle">Mkety Trading<\/h1>/);
});
