import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

const RECOVERY_CRON = '* * * * *';
const LEGACY_CRON = '*/15 * * * *';

test('one-minute cron runs MTProto recovery only and never multiplies legacy scheduled work', async () => {
  let recoveryCalls = 0;
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response('ok'),
      scheduled: async () => { legacyCalls += 1; },
    },
    recoveryRuntime: async () => { recoveryCalls += 1; return { checked: 1 }; },
  });

  const result = await entry.scheduled({ cron: RECOVERY_CRON }, {}, {});

  assert.deepEqual(result, { checked: 1 });
  assert.equal(recoveryCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('existing 15-minute cron stays delegated to legacy scheduler and does not run recovery', async () => {
  let recoveryCalls = 0;
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response('ok'),
      scheduled: async () => { legacyCalls += 1; return 'legacy-result'; },
    },
    recoveryRuntime: async () => { recoveryCalls += 1; },
  });

  const result = await entry.scheduled({ cron: LEGACY_CRON }, {}, {});

  assert.equal(result, 'legacy-result');
  assert.equal(legacyCalls, 1);
  assert.equal(recoveryCalls, 0);
});

test('wrangler registers both exact cron expressions', async () => {
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /crons\s*=\s*\[[^\]]*"\*\/15 \* \* \* \*"[^\]]*"\* \* \* \* \*"[^\]]*\]/s);
});
