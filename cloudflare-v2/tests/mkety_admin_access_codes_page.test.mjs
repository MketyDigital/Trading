import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMketyAdminAccessCodesPage } from '../src/dashboard_mkety_admin_access_codes.js';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

test('Mkety staff access-code page is separate, secret-safe, and supports create/list/revoke', () => {
  const html = renderMketyAdminAccessCodesPage();

  assert.match(html, /Mkety Staff Access Codes/);
  assert.match(html, /\/api\/v1\/mkety-admin\/access-codes/);
  assert.match(html, /Create access code/);
  assert.match(html, /Revoke/);
  assert.match(html, /shown once/i);

  assert.doesNotMatch(html, /code_hash|codeHash|credential_ciphertext/i);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.doesNotMatch(html, /\/api\/v1\/admin\/(destinations|sources|routes|templates)/);
  assert.doesNotMatch(html, /apiId|apiHash|sessionString|botToken|signingSecret/);
});

test('Trading V1 entrypoint serves Mkety staff access-code page without enabling tenant Trading APIs', async () => {
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      async fetch() {
        legacyCalls += 1;
        return new Response('legacy', { status: 200 });
      },
    },
  });

  const response = await entry.fetch(
    new Request('https://trade.mkety.com/mkety-admin/access-codes'),
    { TRADING_ACCESS_ENABLED: 'false', BROKER_EXECUTION_ENABLED: 'false' },
    {},
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(await response.text(), /Mkety Staff Access Codes/);
  assert.equal(legacyCalls, 0);
});
