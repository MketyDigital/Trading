import { pathToFileURL } from 'node:url';
import { runSoak } from './mtproto_container_soak.mjs';

const PROVIDERS = [
  ['cloudflare_container_mtproto', 'CONTAINER'],
  ['cloudflare_do_mtproto', 'DO'],
  ['external_mtproto', 'EXTERNAL'],
];

function present(value) {
  return String(value ?? '').trim().length > 0;
}

function providerEnv(env, prefix) {
  return {
    MTPROTO_SOAK_ENABLED: 'true',
    MTPROTO_SOAK_HEALTH_URL: env[`GATE5_${prefix}_HEALTH_URL`],
    MTPROTO_SOAK_EVENTS_URL: env[`GATE5_${prefix}_EVENTS_URL`],
    MTPROTO_SOAK_WORKSPACE_ID: env.GATE5_WORKSPACE_ID,
    MTPROTO_SOAK_SOURCE_ID: env[`GATE5_${prefix}_SOURCE_ID`],
    MTPROTO_SOAK_BEARER_TOKEN: env.GATE5_BEARER_TOKEN,
    MTPROTO_SOAK_DURATION_MS: env.GATE5_SOAK_DURATION_MS,
    MTPROTO_SOAK_POLL_MS: env.GATE5_SOAK_POLL_MS,
  };
}

export function validateGate5Environment(env = {}) {
  if (String(env.TRADING_ACCESS_ENABLED ?? '').toLowerCase() !== 'false') return { ok: false, reason: 'TRADING_ACCESS_MUST_REMAIN_DISABLED' };
  if (String(env.BROKER_EXECUTION_ENABLED ?? '').toLowerCase() !== 'false') return { ok: false, reason: 'BROKER_EXECUTION_MUST_REMAIN_DISABLED' };
  const required = ['GATE5_WORKSPACE_ID', 'GATE5_BEARER_TOKEN'];
  for (const [, prefix] of PROVIDERS) required.push(`GATE5_${prefix}_SOURCE_ID`, `GATE5_${prefix}_HEALTH_URL`, `GATE5_${prefix}_EVENTS_URL`);
  const missing = required.filter((name) => !present(env[name]));
  return missing.length ? { ok: false, reason: 'GATE5_CONFIG_MISSING', missing } : { ok: true, missing: [] };
}

export function evaluateGate5AcceptanceEvidence(evidence = []) {
  const reasons = [];
  const byType = new Map((Array.isArray(evidence) ? evidence : []).map((item) => [item?.providerType, item]));

  for (const [providerType] of PROVIDERS) {
    const item = byType.get(providerType);
    if (!item) {
      reasons.push(`missing provider ${providerType}`);
      continue;
    }
    const healthy = item.finalHealthy ?? (String(item.finalHealthStatus ?? '').toUpperCase() === 'HEALTHY' && item.finalConnected === true);
    if (!healthy) reasons.push(`${providerType} final health not healthy`);
    if (Number(item.reconnectCount ?? 0) < 1) reasons.push(`${providerType} reconnect evidence missing`);
    if (Number(item.catchUpCount ?? 0) < 1) reasons.push(`${providerType} catch-up evidence missing`);
    if (Number(item.duplicateCount ?? 0) < 1) reasons.push(`${providerType} duplicate replay evidence missing`);
    if (Number(item.editedCount ?? 1) < 1) reasons.push(`${providerType} edited-message evidence missing`);
    if (item.downstreamIsolationObserved !== true) reasons.push(`${providerType} downstream isolation evidence missing`);
  }

  const nonContainerTouched = ['cloudflare_do_mtproto', 'external_mtproto'].some((type) => byType.get(type)?.containerTouched === true);
  const containerObserved = byType.get('cloudflare_container_mtproto')?.containerTouched === true;
  const containerIsolation = containerObserved && !nonContainerTouched;
  if (!containerIsolation) reasons.push('container isolation/guard evidence failed');

  const digestOwners = new Map();
  for (const [providerType, item] of byType.entries()) {
    for (const digest of item?.canonicalEventDigests ?? []) {
      if (!digestOwners.has(digest)) digestOwners.set(digest, new Set());
      digestOwners.get(digest).add(providerType);
    }
  }
  const crossProviderDuplicateConvergence = [...digestOwners.values()].some((owners) => owners.size >= 2);
  if (!crossProviderDuplicateConvergence) reasons.push('cross-provider duplicate convergence evidence missing');

  return {
    ok: reasons.length === 0,
    providerCount: byType.size,
    crossProviderDuplicateConvergence,
    containerIsolation,
    reasons,
  };
}

export async function runGate5Acceptance({ env = process.env, fetchImpl = fetch } = {}) {
  const validation = validateGate5Environment(env);
  if (!validation.ok) return validation;

  const observations = await Promise.all(PROVIDERS.map(async ([providerType, prefix]) => {
    const result = await runSoak({ env: providerEnv(env, prefix), fetchImpl });
    if (!result.ok) return { providerType, sourceId: env[`GATE5_${prefix}_SOURCE_ID`], observationError: result.reason };
    return { providerType, ...result.summary };
  }));

  const evaluation = evaluateGate5AcceptanceEvidence(observations);
  return {
    ...evaluation,
    providers: observations.map((item) => ({
      providerType: item.providerType,
      sourceId: item.sourceId,
      finalHealthStatus: item.finalHealthStatus ?? null,
      finalConnected: item.finalConnected ?? null,
      reconnectCount: item.reconnectCount ?? 0,
      catchUpCount: item.catchUpCount ?? 0,
      editedCount: item.editedCount ?? 0,
      duplicateCount: item.duplicateCount ?? 0,
      downstreamIsolationObserved: item.downstreamIsolationObserved === true,
      containerTouched: item.containerTouched === true,
      observationError: item.observationError ?? null,
    })),
  };
}

async function main() {
  const result = await runGate5Acceptance();
  const output = JSON.stringify(result, null, 2);
  if (!result.ok) {
    console.error(output);
    process.exitCode = 1;
    return;
  }
  console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ ok: false, reason: 'GATE5_SOAK_RUNTIME_FAILED' }));
    process.exitCode = 1;
  });
}
