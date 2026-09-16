// Compatibility shim only.
// Canonical invalid-protection authority lives in
// src/execution/protection_validation_policy.js and is applied before
// position-group planning. Late broker-dispatch validation must not duplicate
// or reinterpret protection semantics after planning.
export function normalizeProtectionPolicy() {
  return {
    invalidProtectionPolicy: 'canonical_preplanning_authority',
    allowInvalidStopLossSkip: false,
    allowInvalidTakeProfitSkip: false,
  };
}

export function applyProtectionValidationPolicy(action = {}) {
  if (!action || typeof action !== 'object') {
    return { allowed: false, reason: 'INVALID_EXECUTION_ACTION', action, skipped: [] };
  }
  return { allowed: true, action: { ...action }, skipped: [] };
}
