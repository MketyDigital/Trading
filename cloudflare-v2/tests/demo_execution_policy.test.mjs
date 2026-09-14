import test from 'node:test';
import assert from 'node:assert/strict';

import { brokerAccountExecutionDefaults } from '../src/execution/demo_execution_policy.js';

test('connected DEMO execution accounts are always active and executable but never live-enabled', () => {
  assert.deepEqual(brokerAccountExecutionDefaults({
    environment: 'demo', roles: ['source', 'execution'], connected: true,
  }), {
    is_active: true,
    execution_enabled: true,
    live_execution_enabled: false,
    safety_policy: { killSwitch: false },
  });
});

test('pending DEMO accounts remain fail-closed until broker identity is connected', () => {
  assert.deepEqual(brokerAccountExecutionDefaults({
    environment: 'demo', roles: ['execution'], connected: false,
  }), {
    is_active: false,
    execution_enabled: false,
    live_execution_enabled: false,
    safety_policy: { killSwitch: true },
  });
});

test('LIVE accounts remain fail-closed even when connected', () => {
  assert.deepEqual(brokerAccountExecutionDefaults({
    environment: 'live', roles: ['execution'], connected: true,
  }), {
    is_active: false,
    execution_enabled: false,
    live_execution_enabled: false,
    safety_policy: { killSwitch: true },
  });
});

test('DEMO accounts without execution role do not become executable', () => {
  assert.deepEqual(brokerAccountExecutionDefaults({
    environment: 'demo', roles: ['source'], connected: true,
  }), {
    is_active: true,
    execution_enabled: false,
    live_execution_enabled: false,
    safety_policy: { killSwitch: true },
  });
});
