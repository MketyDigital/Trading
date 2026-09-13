import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('OAuth onboarding persists cTrader app credentials with account tokens for production dispatch', () => {
  const source = fs.readFileSync(path.resolve(here, '../src/http/v1_admin_connections.js'), 'utf8');
  const call = source.match(/encryptConnectionCredentials\('ctrader',\s*\{([\s\S]*?)\}\s*,\s*env\.TRADING_MASTER_KEY\)/);
  assert.ok(call, 'cTrader OAuth credential encryption call must exist');
  assert.match(call[1], /clientId:\s*env\.CTRADER_CLIENT_ID/);
  assert.match(call[1], /clientSecret:\s*env\.CTRADER_CLIENT_SECRET/);
  assert.match(call[1], /accessToken:\s*token\.accessToken/);
  assert.match(call[1], /refreshToken:\s*token\.refreshToken/);
});
