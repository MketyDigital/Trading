import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

const RECOVERY_CRON = '* * * * *';
const LEGACY_CRON = '*/15 * * * *';

test('one-minute cron runs MTProto and destination retry recovery independently without multiplying legacy work', async () => {
  let mtprotoCalls = 0;
  let destinationCalls = 0;
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response('ok'),
      scheduled: async () => { legacyCalls += 1; },
    },
    recoveryRuntime: async () => { mtprotoCalls += 1; return { checked: 1 }; },
    destinationRetryRuntime: async () => { destinationCalls += 1; return { status: 'BROKER_EXECUTION_DISABLED' }; },
  });

  const result = await entry.scheduled({ cron: RECOVERY_CRON }, {}, {});

  assert.deepEqual(result, {
    mtprotoRecovery: 'fulfilled',
    destinationRetryRecovery: 'fulfilled',
  });
  assert.equal(mtprotoCalls, 1);
  assert.equal(destinationCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('one recovery failure cannot prevent the sibling one-minute recovery runtime', async () => {
  let destinationCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => new Response('ok') },
    recoveryRuntime: async () => { throw new Error('mtproto failure'); },
    destinationRetryRuntime: async () => { destinationCalls += 1; return { status: 'COMPLETED' }; },
  });

  const result = await entry.scheduled({ cron: RECOVERY_CRON }, {}, {});
  assert.equal(destinationCalls, 1);
  assert.deepEqual(result, {
    mtprotoRecovery: 'rejected',
    destinationRetryRecovery: 'fulfilled',
  });
});

test('existing 15-minute cron stays delegated to legacy scheduler and does not run either recovery runtime', async () => {
  let mtprotoCalls = 0;
  let destinationCalls = 0;
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response('ok'),
      scheduled: async () => { legacyCalls += 1; return 'legacy-result'; },
    },
    recoveryRuntime: async () => { mtprotoCalls += 1; },
    destinationRetryRuntime: async () => { destinationCalls += 1; },
  });

  const result = await entry.scheduled({ cron: LEGACY_CRON }, {}, {});

  assert.equal(result, 'legacy-result');
  assert.equal(legacyCalls, 1);
  assert.equal(mtprotoCalls, 0);
  assert.equal(destinationCalls, 0);
});

test('wrangler registers both exact cron expressions', async () => {
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /crons\s*=\s*\[[^\]]*"\*\/15 \* \* \* \*"[^\]]*"\* \* \* \* \*"[^\]]*\]/s);
});
