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

test('production verification checks broker secrets at deployed sources without copying their values', () => {
  const workflow = read('.github/workflows/production-platform-secret-sync.yml');

  assert.match(workflow, /wrangler secret list/);
  assert.match(workflow, /CTRADER_CLIENT_ID/);
  assert.match(workflow, /CTRADER_CLIENT_SECRET/);
  assert.match(workflow, /CBOT_TOKEN_SIGNING_KEY/);
  assert.match(workflow, /CBOT_CONTROL_SECRET/);
  assert.match(workflow, /applications\/\$uuid\/envs/);
  assert.match(workflow, /CBOT_PUBLIC_HOST/);
  assert.match(workflow, /PUBLIC_GATEWAY_HEALTH=PASS/);
  assert.match(workflow, /\/v1\/cbot/);
  assert.match(workflow, /\/v1\/mt5/);
  assert.doesNotMatch(workflow, /wrangler secret bulk/);
  assert.doesNotMatch(workflow, /secrets\.CTRADER_CLIENT_ID/);
  assert.doesNotMatch(workflow, /secrets\.CTRADER_CLIENT_SECRET/);
  assert.doesNotMatch(workflow, /secrets\.CBOT_TOKEN_SIGNING_KEY/);
  assert.doesNotMatch(workflow, /secrets\.CBOT_CONTROL_SECRET/);
});

test('production broker verification remains fail closed and never enables live execution', () => {
  const workflow = read('.github/workflows/production-platform-secret-sync.yml');

  assert.match(workflow, /Worker broker secret binding missing after deploy/);
  assert.match(workflow, /Coolify gateway environment key missing/);
  assert.match(workflow, /Expected exactly one Mkety gateway application/);
  assert.doesNotMatch(workflow, /CTRADER_LIVE_TRADING_ENABLED:\s*true/i);
  assert.doesNotMatch(workflow, /liveBrokerExecutionEnabled\s*[:=]\s*true/i);
});

test('production browser E2E explicitly verifies cTrader Direct readiness', () => {
  const workflow = read('.github/workflows/production-frontend-e2e.yml');
  assert.match(workflow, /\/api\/v1\/admin\/connections/);
  assert.match(workflow, /readiness\.ctrader\.configured/);
  assert.match(workflow, /CTRADER_DIRECT_READINESS=PASS/);
});
