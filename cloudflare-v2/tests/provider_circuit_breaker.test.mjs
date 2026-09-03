import test from 'node:test';
import assert from 'node:assert/strict';

import { createProviderCircuitBreaker } from '../src/resilience/provider_circuit_breaker.js';

function key(overrides = {}) {
  return {
    purpose: 'destination_ai',
    provider: 'openai',
    workspaceId: 'ws-a',
    ...overrides,
  };
}

test('opens only the exact purpose/provider/workspace after bounded consecutive failures', () => {
  let now = 1000;
  const breaker = createProviderCircuitBreaker({ failureThreshold: 2, resetAfterMs: 500, clock: () => now });

  assert.equal(breaker.canAttempt(key()).allowed, true);
  breaker.recordFailure(key());
  assert.equal(breaker.canAttempt(key()).state, 'CLOSED');
  breaker.recordFailure(key());

  assert.deepEqual(breaker.canAttempt(key()), {
    allowed: false,
    state: 'OPEN',
    retryAfterMs: 500,
  });

  assert.equal(breaker.canAttempt(key({ workspaceId: 'ws-b' })).allowed, true);
  assert.equal(breaker.canAttempt(key({ provider: 'anthropic' })).allowed, true);
  assert.equal(breaker.canAttempt(key({ purpose: 'ambiguity_ai' })).allowed, true);
});

test('moves to HALF_OPEN after cooldown and permits only one probe until success resets it', () => {
  let now = 2000;
  const breaker = createProviderCircuitBreaker({ failureThreshold: 1, resetAfterMs: 100, clock: () => now });
  breaker.recordFailure(key());

  now = 2099;
  assert.equal(breaker.canAttempt(key()).allowed, false);

  now = 2100;
  assert.deepEqual(breaker.canAttempt(key()), { allowed: true, state: 'HALF_OPEN', retryAfterMs: 0 });
  assert.deepEqual(breaker.canAttempt(key()), { allowed: false, state: 'HALF_OPEN', retryAfterMs: 0 });

  breaker.recordSuccess(key());
  assert.deepEqual(breaker.canAttempt(key()), { allowed: true, state: 'CLOSED', retryAfterMs: 0 });
});

test('failed HALF_OPEN probe reopens only that exact circuit', () => {
  let now = 3000;
  const breaker = createProviderCircuitBreaker({ failureThreshold: 1, resetAfterMs: 200, clock: () => now });
  breaker.recordFailure(key());
  now = 3200;
  assert.equal(breaker.canAttempt(key()).state, 'HALF_OPEN');
  breaker.recordFailure(key());

  assert.deepEqual(breaker.canAttempt(key()), { allowed: false, state: 'OPEN', retryAfterMs: 200 });
  assert.equal(breaker.canAttempt(key({ workspaceId: 'ws-b' })).allowed, true);
});

test('state is bounded and oldest inactive circuits are evicted', () => {
  let now = 4000;
  const breaker = createProviderCircuitBreaker({ maxCircuits: 2, failureThreshold: 1, resetAfterMs: 1000, clock: () => now });

  breaker.recordFailure(key({ workspaceId: 'ws-a' }));
  now += 1;
  breaker.recordFailure(key({ workspaceId: 'ws-b' }));
  now += 1;
  breaker.recordFailure(key({ workspaceId: 'ws-c' }));

  assert.equal(breaker.size(), 2);
  assert.equal(breaker.canAttempt(key({ workspaceId: 'ws-a' })).allowed, true);
  assert.equal(breaker.canAttempt(key({ workspaceId: 'ws-b' })).allowed, false);
  assert.equal(breaker.canAttempt(key({ workspaceId: 'ws-c' })).allowed, false);
});

test('malformed or secret-bearing key material fails open without retaining state', () => {
  const breaker = createProviderCircuitBreaker();

  assert.deepEqual(breaker.canAttempt({ purpose: 'destination_ai', provider: 'openai' }), {
    allowed: true,
    state: 'CLOSED',
    retryAfterMs: 0,
  });
  breaker.recordFailure({ purpose: 'destination_ai', provider: 'openai', workspaceId: 'ws-a', token: 'secret-value' });
  assert.equal(breaker.size(), 0);
});

test('breaker clock failure never blocks dependency work', () => {
  const breaker = createProviderCircuitBreaker({
    failureThreshold: 1,
    clock: () => { throw new Error('clock down'); },
  });

  assert.doesNotThrow(() => breaker.recordFailure(key()));
  assert.deepEqual(breaker.canAttempt(key()), {
    allowed: true,
    state: 'CLOSED',
    retryAfterMs: 0,
  });
});
