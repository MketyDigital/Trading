import test from 'node:test';
import assert from 'node:assert/strict';

import { withEnterpriseConnectionEnhancements } from '../src/dashboard_enterprise_enhancements.js';

test('enterprise portal enhancement exposes signed/raw webhook modes and persists webhookMode', () => {
  const html = withEnterpriseConnectionEnhancements('<html><body><select id="destinationType"></select><div id="destinationFields"></div><button id="createDestinationBtn"></button></body></html>');
  assert.match(html, /id=\\?"destWebhookMode\\?"/);
  assert.match(html, /mkety_signed/);
  assert.match(html, /raw_text/);
  assert.match(html, /raw_json/);
  assert.match(html, /webhookMode/);
});
