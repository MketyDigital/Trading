import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testsDir, '..');

test('MT5 bridge crash-gap reconciliation Python contract passes', () => {
  const result = spawnSync(
    'python',
    ['-m', 'unittest', 'bridges/test_mt5_bridge_reconciliation.py', '-v'],
    {
      cwd: rootDir,
      env: { ...process.env, PYTHONPATH: 'bridges' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, `Python reconciliation contract failed:\n${result.stdout}\n${result.stderr}`);
});
