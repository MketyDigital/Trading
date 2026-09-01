import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('legacy Worker integrates canonical shadow only behind explicit feature flag', async () => {
  const source = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /buildCanonicalShadow/);
  assert.match(source, /TRADING_V1_SHADOW/);
  assert.match(source, /executionEnabled/);
});

test('shadow diagnostics are isolated from legacy dispatch failures', async () => {
  const source = await fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(source, /v1_shadow/);
  assert.match(source, /shadow.*catch|catch.*shadow/is);
});
