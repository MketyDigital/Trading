import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.resolve(here, '../../.github/workflows/production-cloudflare-deploy.yml'), 'utf8');

test('production deploy reads and verifies owner switch without requiring OFF or mutating it', () => {
  assert.match(workflow, /brokerExecutionCapabilityEnabled/);
  assert.match(workflow, /brokerExecutionEnabled/);
  assert.match(workflow, /effectiveBrokerExecutionEnabled/);
  assert.doesNotMatch(workflow, /owner broker switch must remain OFF/i);
  assert.doesNotMatch(workflow, /effective broker execution must remain blocked/i);
  assert.doesNotMatch(workflow, /Broker owner master switch: OFF/);
  assert.doesNotMatch(workflow, /method:\s*['\"]?PATCH/i);
  assert.doesNotMatch(workflow, /curl[^\n]*-X\s+PATCH[^\n]*runtime-controls/i);
  assert.match(workflow, /effectiveBrokerExecutionEnabled[^\n]*brokerExecutionCapabilityEnabled[^\n]*brokerExecutionEnabled|expectedEffective/);
});
