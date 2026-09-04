import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

const RECOVERY_CRON = '* * * * *';
const LEGACY_CRON = '*/15 * * * *';

test('one-minute cron runs MTProto, destination retry, and state binding repair independently without multiplying legacy work', async () => {
  let mtprotoCalls = 0;
  let destinationCalls = 0;
  let bindingRepairCalls = 0;
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response('ok'),
      scheduled: async () => { legacyCalls += 1; },
    },
    recoveryRuntime: async () => { mtprotoCalls += 1; return { checked: 1 }; },
    destinationRetryRuntime: async () => { destinationCalls += 1; return { status: 'BROKER_EXECUTION_DISABLED' }; },
    bindingRepairRuntime: async () => { bindingRepairCalls += 1; return { scanned: 1, repaired: 1, failed: 0 }; },
  });

  const result = await entry.scheduled({ cron: RECOVERY_CRON }, {
    TRADING_ACCESS_ENABLED: 'false',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});

  assert.deepEqual(result, {
    mtprotoRecovery: 'fulfilled',
    destinationRetryRecovery: 'fulfilled',
    bindingRepairRecovery: 'fulfilled',
  });
  assert.equal(mtprotoCalls, 1);
  assert.equal(destinationCalls, 1);
  assert.equal(bindingRepairCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('one recovery failure cannot prevent sibling one-minute recovery runtimes', async () => {
  let destinationCalls = 0;
  let bindingRepairCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => new Response('ok') },
    recoveryRuntime: async () => { throw new Error('mtproto failure'); },
    destinationRetryRuntime: async () => { destinationCalls += 1; return { status: 'COMPLETED' }; },
    bindingRepairRuntime: async () => { bindingRepairCalls += 1; return { repaired: 1 }; },
  });

  const result = await entry.scheduled({ cron: RECOVERY_CRON }, {}, {});
  assert.equal(destinationCalls, 1);
  assert.equal(bindingRepairCalls, 1);
  assert.deepEqual(result, {
    mtprotoRecovery: 'rejected',
    destinationRetryRecovery: 'fulfilled',
    bindingRepairRecovery: 'fulfilled',
  });
});

test('state binding repair failure cannot prevent MTProto or destination retry recovery', async () => {
  let mtprotoCalls = 0;
  let destinationCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => new Response('ok') },
    recoveryRuntime: async () => { mtprotoCalls += 1; return { checked: 1 }; },
    destinationRetryRuntime: async () => { destinationCalls += 1; return { status: 'COMPLETED' }; },
    bindingRepairRuntime: async () => { throw new Error('state unavailable'); },
  });

  const result = await entry.scheduled({ cron: RECOVERY_CRON }, {}, {});
  assert.equal(mtprotoCalls, 1);
  assert.equal(destinationCalls, 1);
  assert.deepEqual(result, {
    mtprotoRecovery: 'fulfilled',
    destinationRetryRecovery: 'fulfilled',
    bindingRepairRecovery: 'rejected',
  });
});

test('existing 15-minute cron stays delegated to legacy scheduler and does not run recovery runtimes', async () => {
  let mtprotoCalls = 0;
  let destinationCalls = 0;
  let bindingRepairCalls = 0;
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response('ok'),
      scheduled: async () => { legacyCalls += 1; return 'legacy-result'; },
    },
    recoveryRuntime: async () => { mtprotoCalls += 1; },
    destinationRetryRuntime: async () => { destinationCalls += 1; },
    bindingRepairRuntime: async () => { bindingRepairCalls += 1; },
  });

  const result = await entry.scheduled({ cron: LEGACY_CRON }, {}, {});

  assert.equal(result, 'legacy-result');
  assert.equal(legacyCalls, 1);
  assert.equal(mtprotoCalls, 0);
  assert.equal(destinationCalls, 0);
  assert.equal(bindingRepairCalls, 0);
});

test('wrangler registers both exact cron expressions', async () => {
  const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /crons\s*=\s*\[[^\]]*"\*\/15 \* \* \* \*"[^\]]*"\* \* \* \* \*"[^\]]*\]/s);
});
