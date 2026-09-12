import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('returning-session bootstrap exposes an awaitable restore contract before portal startup', () => {
  const helper = read('cloudflare-v2/src/dashboard_returning_session.js');

  assert.match(helper, /mketyTradingRestoreSession/);
  assert.match(helper, /mketyTradingSessionRestorePromise/);
  assert.match(helper, /awaitReturningSession/);
  assert.match(helper, /await window\.mketyTradingSessionRestorePromise/);
  assert.match(helper, /<body\(\[\^>\]\*\)>/);
});

test('production post-deploy sync preserves server-side cTrader Direct and shared gateway secrets', () => {
  const workflow = read('.github/workflows/production-platform-secret-sync.yml');

  for (const key of [
    'CTRADER_CLIENT_ID',
    'CTRADER_CLIENT_SECRET',
    'CBOT_TOKEN_SIGNING_KEY',
    'CBOT_CONTROL_SECRET',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${key}`));
    assert.match(workflow, new RegExp(`Worker secret binding missing after sync: \\${required}`.replace('\\${required}', key)));
  }
  assert.match(workflow, /wrangler secret bulk/);
  assert.match(workflow, /wrangler secret list/);
  assert.match(workflow, /Production Cloudflare Deploy/);
});

test('production platform secret pairs stay atomic and fail closed', () => {
  const workflow = read('.github/workflows/production-platform-secret-sync.yml');

  assert.match(workflow, /cTrader Direct/);
  assert.match(workflow, /Shared cTrader\/MT5 gateway/);
  assert.match(workflow, /production configuration is partial/);
  assert.match(workflow, /production configuration is absent/);
  assert.doesNotMatch(workflow, /CTRADER_LIVE_TRADING_ENABLED:\s*true/i);
});
