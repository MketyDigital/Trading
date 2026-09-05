import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingReadiness } from '../src/config/staging_readiness.js';

function completeCore(overrides = {}) {
  return {
    SUPABASE_URL: 'https://staging.supabase.co',
    SUPABASE_SERVICE_ROLE: 'secret-service-key',
    TRADING_MASTER_KEY: 'secret-master-key',
    TRADING_ACCESS_ENABLED: 'false',
    ...overrides,
  };
}

function completeAccess(overrides = {}) {
  return completeCore({
    TRADING_ACCESS_ENABLED: 'true',
    MKETY_ACCESS_ISSUER: 'https://access.mkety.example',
    MKETY_ACCESS_AUDIENCE: 'mkety-trading',
    MKETY_ACCESS_JWKS_URL: 'https://access.mkety.example/.well-known/jwks.json',
    ...overrides,
  });
}

test('reports missing core staging configuration names without exposing values', () => {
  const result = validateStagingReadiness({
    SUPABASE_URL: 'https://staging.supabase.co',
    TRADING_MASTER_KEY: 'do-not-leak-this',
    TRADING_ACCESS_ENABLED: 'false',
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['SUPABASE_SERVICE_ROLE']);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('do-not-leak-this'), false);
  assert.equal(serialized.includes('https://staging.supabase.co'), false);
});

test('core staging is ready without identity-provider config while trading access is disabled', () => {
  const result = validateStagingReadiness(completeCore());

  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.features.accessEnabled, false);
  assert.equal(result.optionalMissing.includes('MKETY_ACCESS_ISSUER'), true);
  assert.equal(result.optionalMissing.includes('MKETY_ACCESS_AUDIENCE'), true);
  assert.equal(result.optionalMissing.includes('MKETY_ACCESS_JWKS_URL'), true);
});

test('trading access fails closed when Mkety access-gate configuration is missing', () => {
  const result = validateStagingReadiness(completeCore({
    TRADING_ACCESS_ENABLED: 'true',
  }));

  assert.equal(result.ready, false);
  assert.deepEqual(result.missing.sort(), [
    'MKETY_ACCESS_AUDIENCE',
    'MKETY_ACCESS_ISSUER',
    'MKETY_ACCESS_JWKS_URL',
  ]);
  assert.equal(result.features.accessEnabled, true);
});

test('trading access is ready when Mkety access-gate configuration is complete', () => {
  const result = validateStagingReadiness(completeAccess());

  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.features.accessEnabled, true);
});

test('accepts supported Supabase service-role aliases but reports canonical missing name', () => {
  const byAlias = validateStagingReadiness(completeCore({
    SUPABASE_SERVICE_ROLE: undefined,
    SUPABASE_SERVICE_ROLE_KEY: 'alias-secret',
  }));
  assert.equal(byAlias.ready, true);

  const missing = validateStagingReadiness(completeCore({
    SUPABASE_SERVICE_ROLE: undefined,
  }));
  assert.equal(missing.missing.includes('SUPABASE_SERVICE_ROLE'), true);
});

test('simulation readiness adds Trade State and explicit staging market-context requirements', () => {
  const result = validateStagingReadiness(completeCore(), { requireSimulation: true });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing.sort(), [
    'TRADE_STATE_INTERNAL_TOKEN',
    'TRADE_STATE_NAMESPACE',
    'TRADING_V1_SIMULATION_INSTRUMENTS',
    'TRADING_V1_SIMULATION_PRICES',
  ]);
  assert.equal(result.features.simulationRequested, true);
  assert.equal(result.features.shadowEnabled, false);
});

test('complete staging simulation configuration returns ready without echoing secrets or JSON config', () => {
  const env = completeCore({
    TRADE_STATE_INTERNAL_TOKEN: 'internal-secret',
    TRADE_STATE_NAMESPACE: { idFromName() {}, get() {} },
    TRADING_V1_SIMULATION: 'true',
    TRADING_V1_SHADOW: 'true',
    TRADING_V1_SIMULATION_INSTRUMENTS: JSON.stringify({ XAUUSD: { tickSize: 0.01, tickValue: 1 } }),
    TRADING_V1_SIMULATION_PRICES: JSON.stringify({ XAUUSD: 2500 }),
  });
  const result = validateStagingReadiness(env, { requireSimulation: true });
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.features.simulationRequested, true);
  assert.equal(result.features.simulationEnabled, true);
  assert.equal(result.features.shadowEnabled, true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('internal-secret'), false);
  assert.equal(serialized.includes('2500'), false);
  assert.equal(serialized.includes('XAUUSD'), false);
});

test('optional access-gate config is reported by name only and does not block core readiness', () => {
  const result = validateStagingReadiness(completeCore());
  assert.equal(result.ready, true);
  assert.equal(result.optionalMissing.includes('MKETY_ACCESS_ISSUER'), true);
  assert.equal(result.optionalMissing.includes('MKETY_ACCESS_AUDIENCE'), true);
  assert.equal(result.optionalMissing.includes('TRADING_V1_AI_TIMEOUT_MS'), true);
});
