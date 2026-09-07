import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

test('worker module exports fetch and scheduled handlers', () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
});
