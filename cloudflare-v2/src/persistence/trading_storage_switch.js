const AUTHORITIES = new Set(['d1', 'postgres']);
const REQUIRED_EVIDENCE = [
  'ingressPaused',
  'consumersPaused',
  'inFlightDrained',
  'uncertainBrokerOperationsReconciled',
  'replicationCaughtUp',
  'parityVerified',
  'liveExecutionDisabled',
];

export function planTradingStorageSwitch({ current, target, authorityEpoch, evidence = {} }) {
  if (!AUTHORITIES.has(current) || !AUTHORITIES.has(target) || current === target) throw new Error('Switch must move between distinct supported authorities');
  const epoch = Number(authorityEpoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch >= Number.MAX_SAFE_INTEGER) throw new Error('A valid current authority epoch is required');
  const missing = REQUIRED_EVIDENCE.filter(key => evidence[key] !== true);
  if (missing.length) throw new Error(`Trading storage switch blocked; required evidence: ${missing.join(', ')}`);
  return Object.freeze({
    current,
    target,
    expectedEpoch: epoch,
    nextEpoch: epoch + 1,
    steps: Object.freeze(['fence_current', 'activate_target', 'verify_target', 'resume_consumers']),
  });
}

/**
 * Execute only the guarded authority handoff. Callbacks must use conditional
 * writes with expectedEpoch and persist fencing/activation state. Any failure
 * after fencing leaves ingress and consumers paused for operator recovery.
 */
export async function executeTradingStorageSwitch({
  current,
  target,
  authorityEpoch,
  evidence,
  fenceCurrent,
  activateTarget,
  verifyTarget,
  resumeConsumers,
}) {
  const plan = planTradingStorageSwitch({ current, target, authorityEpoch, evidence });
  for (const [name, fn] of Object.entries({ fenceCurrent, activateTarget, verifyTarget, resumeConsumers })) {
    if (typeof fn !== 'function') throw new Error(`Trading storage switch requires ${name}`);
  }
  await fenceCurrent({ authority: current, expectedEpoch: plan.expectedEpoch, nextEpoch: plan.nextEpoch });
  await activateTarget({ authority: target, expectedEpoch: plan.expectedEpoch, nextEpoch: plan.nextEpoch });
  await verifyTarget({ authority: target, authorityEpoch: plan.nextEpoch });
  await resumeConsumers({ authority: target, authorityEpoch: plan.nextEpoch });
  return { activeAuthority: target, authorityEpoch: plan.nextEpoch };
}
