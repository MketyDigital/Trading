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
  const portal = read('cloudflare-v2/src/dashboard_enterprise_portal.js');

  assert.match(helper, /mketyTradingRestoreSession/);
  assert.match(helper, /mketyTradingSessionRestorePromise/);
  assert.match(portal, /awaitReturningSession/);
  assert.match(portal, /mketyTradingSessionRestorePromise/);
});

test('production Worker deploy preserves server-side cTrader Direct OAuth credentials', () => {
  const workflow = read('.github/workflows/production-cloudflare-deploy.yml');

  assert.match(workflow, /PRODUCTION_CTRADER_CLIENT_ID:\s*\$\{\{\s*secrets\.CTRADER_CLIENT_ID\s*\}\}/);
  assert.match(workflow, /PRODUCTION_CTRADER_CLIENT_SECRET:\s*\$\{\{\s*secrets\.CTRADER_CLIENT_SECRET\s*\}\}/);
  assert.match(workflow, /payload\.CTRADER_CLIENT_ID\s*=\s*process\.env\.PRODUCTION_CTRADER_CLIENT_ID/);
  assert.match(workflow, /payload\.CTRADER_CLIENT_SECRET\s*=\s*process\.env\.PRODUCTION_CTRADER_CLIENT_SECRET/);
});

test('production Worker deploy keeps cTrader Direct credential pair atomic and fail-closed', () => {
  const workflow = read('.github/workflows/production-cloudflare-deploy.yml');

  assert.match(workflow, /cTrader Direct production configuration is partial/);
  assert.match(workflow, /CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET/);
});
