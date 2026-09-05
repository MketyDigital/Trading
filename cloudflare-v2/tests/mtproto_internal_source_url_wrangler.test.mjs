import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const paidWranglerUrl = new URL('../wrangler.toml', import.meta.url);

const EXPECTED_INTERNAL_SOURCE_URL =
  'https://mkety-copier-engine.dry-glitter-7e16.workers.dev/api/v1/internal/source-event';

test('paid staging declares the first-party MTProto internal source callback URL', async () => {
  const wrangler = await readFile(paidWranglerUrl, 'utf8');

  assert.match(
    wrangler,
    new RegExp(`^MTPROTO_INTERNAL_SOURCE_URL = "${EXPECTED_INTERNAL_SOURCE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'm'),
  );
});
