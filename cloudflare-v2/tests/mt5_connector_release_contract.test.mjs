import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/mt5-connector-release.yml'), 'utf8');
const dashboard = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');

test('MT5 dashboard uses the stable latest asset and CI builds the one-file Windows package', () => {
  assert.match(dashboard, /releases\/latest\/download\/MketyMT5Connector\.exe/);
  assert.doesNotMatch(dashboard, /releases\/download\/mt5-connector-v1\.0\.0\/MketyMT5Connector\.exe/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /pyinstaller/i);
  assert.match(workflow, /numpy==/i);
  assert.match(workflow, /--collect-all\s+numpy/i);
  assert.match(workflow, /MketyMT5Connector\.exe/);
  assert.match(workflow, /--runtime-smoke/);
  assert.match(workflow, /sha256/i);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});

test('pull request and main branch builds upload artifacts without publishing releases', () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /publish-release:\s*\n\s*if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/mt5-connector-v'\)/);
  assert.doesNotMatch(workflow, /publish-release:[\s\S]*?if:\s*github\.event_name\s*==\s*'workflow_dispatch'/);
  assert.doesNotMatch(workflow, /if:\s*github\.event_name\s*!=\s*'pull_request'[\s\S]{0,250}gh release/);
});

test('release publishing accepts only a new explicit connector version tag and never clobbers assets', () => {
  assert.match(workflow, /refs\/tags\/mt5-connector-v/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--verify-tag/);
  assert.doesNotMatch(workflow, /gh release upload[^\n]*--clobber/);
  assert.doesNotMatch(workflow, /mt5-connector-v1\.0\.0/);
});

test('dashboard download follows the latest stable connector release asset', () => {
  assert.match(dashboard, /releases\/latest\/download\/MketyMT5Connector\.exe/);
});

test('cTrader cBot download remains pinned to its own release asset', () => {
  const cbot = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_ctrader_cbot_connections.js'), 'utf8');
  assert.match(cbot, /releases\/download\/ctrader-cbot-v1\.0\.0\/MketyCloudAutoTrader\.algo/);
  assert.doesNotMatch(cbot, /releases\/latest\/download\/MketyCloudAutoTrader\.algo/);
});
