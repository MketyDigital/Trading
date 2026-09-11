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

test('production Worker deploy automatically follows relevant main changes instead of a magic commit message', () => {
  const workflow = read('.github/workflows/production-cloudflare-deploy.yml');
  assert.match(workflow, /- 'cloudflare-v2\/\*\*'/);
  assert.match(workflow, /- 'ctrader-cbot-gateway\/\*\*'/);
  assert.match(workflow, /- 'ctrader-cbot\/\*\*'/);
  assert.doesNotMatch(workflow, /github\.event\.head_commit\.message\s*==/);
});

test('production frontend E2E explicitly checks cTrader Direct, Cloud Auto Trader, and MT5 setup controls', () => {
  const workflow = read('.github/workflows/production-frontend-e2e.yml');
  assert.match(workflow, /Direct Connection — Recommended/);
  assert.match(workflow, /Cloud Auto Trader/);
  assert.match(workflow, /connectCTraderBtn/);
  assert.match(workflow, /showMt5BridgeBtn/);
  assert.match(workflow, /showMt5CloudBtn/);
});

test('Coolify stack uses repo-root-safe build paths and keeps control API private', () => {
  const compose = read('ctrader-cbot-gateway/deploy/coolify/docker-compose.yml');
  const caddy = read('ctrader-cbot-gateway/deploy/coolify/Caddyfile');
  assert.match(compose, /context:\s*\.\/ctrader-cbot-gateway/);
  assert.match(compose, /dockerfile:\s*Dockerfile/);
  assert.match(compose, /dockerfile:\s*deploy\/coolify\/Dockerfile\.caddy/);
  assert.doesNotMatch(compose, /context:\s*\.\.\/\.\./);
  assert.match(compose, /CBOT_WS_PORT:\s*25346/);
  assert.match(compose, /CBOT_CONTROL_PORT:\s*8790/);
  assert.match(compose, /"25345:25345\/tcp"/);
  assert.doesNotMatch(compose, /"8790:8790/);
  assert.match(caddy, /\{\$CBOT_PUBLIC_HOST\}:25345/);
  assert.match(caddy, /dns cloudflare \{\$CLOUDFLARE_DNS_API_TOKEN\}/);
  assert.match(caddy, /reverse_proxy gateway:25346/);
});

test('cBot release workflow publishes a stable downloadable algo and checksum', () => {
  const workflow = read('.github/workflows/ctrader-cbot-release.yml');
  assert.match(workflow, /ctrader-cbot-v1\.0\.0/);
  assert.match(workflow, /MketyCloudAutoTrader\.algo/);
  assert.match(workflow, /MketyCloudAutoTrader\.algo\.sha256/);
  assert.match(workflow, /gh release (create|upload)/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
});
