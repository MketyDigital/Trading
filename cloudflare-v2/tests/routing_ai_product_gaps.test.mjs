import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleAuthorizedV1AdminDestinationsRequest } from '../src/http/v1_admin_destinations.js';
import { createTelegramDestinationAiFormatter } from '../src/destinations/telegram_ai_formatter.js';
import { withEnterpriseConnectionEnhancements } from '../src/dashboard_enterprise_enhancements.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function auth() {
  return { workspace: { id: 'ws-1' }, membership: { role: 'owner', enabled: true }, auth: { subject: 'owner' } };
}

function request(pathname, method = 'GET') {
  return new Request(`https://copier.starpipsforex.com${pathname}`, { method, headers: { 'Content-Type': 'application/json' } });
}

test('secure AI provider migration removes obsolete plaintext api_key NOT NULL requirement', () => {
  const migration = path.join(here, '../db/migrations/0030_ai_provider_secure_key_compat.sql');
  assert.equal(fs.existsSync(migration), true, '0030 secure AI provider compatibility migration must exist');
  const sql = fs.readFileSync(migration, 'utf8');
  assert.match(sql, /ALTER\s+COLUMN\s+api_key\s+DROP\s+NOT\s+NULL/i);
});

test('owner can permanently remove an unused route', async () => {
  let removed = null;
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    request('/api/v1/admin/routes/route-1', 'DELETE'),
    auth(),
    { destinationStore: { async removeRoute(workspaceId, id) { removed = { workspaceId, id }; return true; } } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(removed, { workspaceId: 'ws-1', id: 'route-1' });
  assert.equal((await response.json()).ok, true);
});

test('owner can remove an unused destination and let DB cascade its routes', async () => {
  let removed = null;
  const response = await handleAuthorizedV1AdminDestinationsRequest(
    request('/api/v1/admin/destinations/dest-1', 'DELETE'),
    auth(),
    { destinationStore: { async removeDestination(workspaceId, id) { removed = { workspaceId, id }; return true; } } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(removed, { workspaceId: 'ws-1', id: 'dest-1' });
  assert.equal((await response.json()).ok, true);
});

test('Telegram presentation AI receives user rebranding instructions as presentation-only data', async () => {
  let seenPayload = null;
  let seenSystemPrompt = null;
  const formatter = createTelegramDestinationAiFormatter({
    async processSignal(payload, systemPrompt) {
      seenPayload = JSON.parse(payload);
      seenSystemPrompt = systemPrompt;
      return { success: true, text: JSON.stringify({ text: 'formatted', canonicalEcho: { side: 'BUY', symbol: 'XAUUSD', entry: 2500, stopLoss: 2490, takeProfits: [2510] } }) };
    },
  });

  await formatter({
    deterministicText: 'BUY XAUUSD',
    brandName: 'Starpips',
    presentation: { aiInstructions: 'Use my concise VIP style and end with Trade responsibly.' },
    canonical: { side: 'BUY', symbol: 'XAUUSD', entry: 2500, stopLoss: 2490, takeProfits: [2510] },
  });

  assert.equal(seenPayload.presentationInstructions, 'Use my concise VIP style and end with Trade responsibly.');
  assert.match(seenSystemPrompt, /Preserve every canonical trading value exactly/i);
});

test('enterprise workspace UI exposes route/destination removal and AI presentation instructions', () => {
  const html = withEnterpriseConnectionEnhancements('<html><body><div id="workspaceMessage"></div></body></html>');
  assert.match(html, /data-route-remove/);
  assert.match(html, /data-destination-remove/);
  assert.match(html, /aiPresentationPrompt/);
  assert.match(html, /AI rebranding\/formatting instructions/i);
});
