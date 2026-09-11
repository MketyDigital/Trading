import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

test('MT5 connector UI uses a stable versioned release asset and workflow builds a Windows executable', () => {
  const ui = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  assert.match(ui, /releases\/download\/mt5-connector-v1\.0\.0\/MketyMT5Connector\.exe/);
  assert.doesNotMatch(ui, /releases\/latest\/download\/MketyMT5Connector\.exe/);

  const workflowPath = path.join(root, '.github/workflows/mt5-connector-release.yml');
  assert.equal(fs.existsSync(workflowPath), true, 'MT5 connector release workflow must exist');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /pyinstaller/i);
  assert.match(workflow, /MketyMT5Connector\.exe/);
  assert.match(workflow, /mt5-connector-v1\.0\.0/);
  assert.match(workflow, /sha256/i);
});

test('cTrader cBot download is pinned so MT5 releases cannot break it', () => {
  const ui = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_ctrader_cbot_connections.js'), 'utf8');
  assert.match(ui, /releases\/download\/ctrader-cbot-v1\.0\.0\/MketyCloudAutoTrader\.algo/);
  assert.doesNotMatch(ui, /releases\/latest\/download\/MketyCloudAutoTrader\.algo/);
});
