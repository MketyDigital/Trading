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

test('production Worker deploy wires cBot URLs and secrets atomically without enabling live trading', () => {
  const workflow = read('.github/workflows/production-cloudflare-deploy.yml');
  for (const key of [
    'CTRADER_CBOT_GATEWAY_URL',
    'CTRADER_CBOT_WS_URL',
    'CBOT_TOKEN_SIGNING_KEY',
    'CBOT_CONTROL_SECRET',
  ]) assert.match(workflow, new RegExp(key));
  assert.match(workflow, /cTrader cBot production configuration is partial/);
  assert.match(workflow, /wss:\/\/<host>:25345\/v1\/cbot/);
  assert.doesNotMatch(workflow, /CTRADER_LIVE_TRADING_ENABLED:\s*true/i);
});

test('Coolify stack keeps control API private and publishes only cTrader Cloud TLS port 25345', () => {
  const compose = read('ctrader-cbot-gateway/deploy/coolify/docker-compose.yml');
  const caddy = read('ctrader-cbot-gateway/deploy/coolify/Caddyfile');
  assert.match(compose, /CBOT_WS_PORT:\s*25346/);
  assert.match(compose, /CBOT_CONTROL_PORT:\s*8790/);
  assert.match(compose, /"25345:25345\/tcp"/);
  assert.doesNotMatch(compose, /"8790:8790/);
  assert.match(caddy, /\{\$CBOT_PUBLIC_HOST\}:25345/);
  assert.match(caddy, /dns cloudflare \{\$CLOUDFLARE_DNS_API_TOKEN\}/);
  assert.match(caddy, /reverse_proxy gateway:25346/);
});
