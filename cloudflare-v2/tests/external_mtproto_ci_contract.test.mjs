import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url), 'utf8');

test('mandatory CI runs both Container and external MTProto Python suites', () => {
  assert.match(
    workflow,
    /PYTHONPATH=containers\/mtproto-listener\s+python -m unittest containers\/mtproto-listener\/test_listener\.py -v/,
  );
  assert.match(
    workflow,
    /PYTHONPATH=external\/mtproto-adapter\s+python -m unittest discover -s external\/mtproto-adapter -p ['"]test_\*\.py['"] -v/,
  );
});
