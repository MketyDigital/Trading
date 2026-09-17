import { normalizeOperationEvidence } from './operation_journal.js';

function text(value, fallback = null) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function revisionIdentity(result = {}) {
  const event = result?.event || {};
  return text(
    event?.metadata?.source_revision_key
      ?? event?.metadata?.sourceRevisionKey
      ?? result?.revisionKey
      ?? result?.revision_key,
    'base',
  );
}

function correlationIdentity(result = {}) {
  return text(result?.event?.external_event_id ?? result?.event?.externalEventId ?? result?.eventId, 'unknown-event');
}

function statusForInterpretation(interpretation = {}) {
  const status = String(interpretation?.status ?? '').toUpperCase();
  if (['READY', 'MANAGEMENT', 'NO_ACTION'].includes(status)) return 'SUCCEEDED';
  if (status === 'NEEDS_REVIEW') return 'BLOCKED';
  return status ? 'INFO' : 'SKIPPED';
}

function statusForDestination(destinations = {}) {
  const status = String(destinations?.status ?? '').toUpperCase();
  if (['DELIVERED', 'SUCCEEDED', 'PARTIAL_SUCCESS'].includes(status) && Number(destinations?.failed || 0) === 0) return 'SUCCEEDED';
  if (status.includes('DUPLICATE') || status === 'SKIPPED') return 'SKIPPED';
  if (status === 'BLOCKED') return 'BLOCKED';
  if (status === 'FAILED' || Number(destinations?.failed || 0) > 0) return 'FAILED';
  return status ? 'INFO' : 'SKIPPED';
}

function statusForSimulation(simulation = {}) {
  const status = String(simulation?.status ?? '').toUpperCase();
  if (['READY', 'PLANNED', 'SUCCEEDED'].includes(status)) return 'SUCCEEDED';
  if (status === 'BLOCKED') return 'BLOCKED';
  if (status === 'FAILED') return 'FAILED';
  if (['NO_ACTION', 'SKIPPED'].includes(status)) return 'SKIPPED';
  return status ? 'INFO' : 'SKIPPED';
}

function statusForExecution(execution = {}) {
  const status = String(execution?.status ?? '').toUpperCase();
  if (['EXECUTED', 'SUCCEEDED', 'PARTIAL_SUCCESS'].includes(status)) return 'SUCCEEDED';
  if (status.includes('DISABLED') || status === 'BLOCKED') return 'BLOCKED';
  if (status.includes('RETRY') || status.includes('UNCERTAIN')) return 'RETRYABLE';
  if (status === 'FAILED') return 'FAILED';
  if (status.includes('SKIPPED') || !status) return 'SKIPPED';
  return 'INFO';
}

function baseEvidence({ sourceId, result }) {
  const workspaceId = text(result?.event?.workspace_hint ?? result?.event?.workspaceId);
  if (!workspaceId) return null;
  const correlationId = correlationIdentity(result);
  const revisionKey = revisionIdentity(result);
  const prefix = `${correlationId}:${revisionKey}`;
  return {
    workspaceId,
    correlationId,
    prefix,
    tradingEventId: text(result?.eventId),
    sourceConnectionId: text(sourceId),
  };
}

function normalized(base, suffix, input) {
  return normalizeOperationEvidence({
    ...base,
    evidenceKey: `${base.prefix}:${suffix}`,
    ...input,
  });
}

function aiDiagnostics(interpretation = {}) {
  const source = interpretation?.ai ?? interpretation?.aiDiagnostics ?? null;
  if (!source || typeof source !== 'object') return null;
  if (Array.isArray(source)) return { attempts: source };
  if (Array.isArray(source.diagnostics)) return { ...source, attempts: source.diagnostics };
  return source;
}

function simulationAccounts(simulation = {}) {
  return Array.isArray(simulation?.accounts) ? simulation.accounts : [];
}

function flattenedSimulationActions(simulation = {}) {
  return simulationAccounts(simulation)
    .flatMap((account) => Array.isArray(account?.actions) ? account.actions : []);
}

function managementEvidenceStatus(simulation = {}) {
  const accounts = simulationAccounts(simulation);
  if (accounts.some((account) => String(account?.status ?? '').toUpperCase() === 'READY')) return 'SUCCEEDED';
  if (accounts.some((account) => String(account?.status ?? '').toUpperCase() === 'BLOCKED')) return 'BLOCKED';
  return flattenedSimulationActions(simulation).length ? 'SUCCEEDED' : 'SKIPPED';
}

export function buildV1LifecycleEvidence({
  sourceId,
  result,
  destinations = null,
  simulation = null,
  execution = null,
} = {}) {
  const base = baseEvidence({ sourceId, result });
  if (!base) return [];

  const rows = [];
  rows.push(normalized(base, 'ingress', {
    stage: 'INGRESS',
    operation: 'source_event_accepted',
    status: result?.ok ? 'SUCCEEDED' : 'FAILED',
    errorCode: result?.ok ? null : text(result?.reason),
    summary: result?.ok ? 'Source event accepted.' : 'Source event rejected.',
    details: {
      duplicate: Boolean(result?.duplicate),
      revision: Boolean(result?.revision),
      sourceType: result?.event?.source_type ?? result?.event?.sourceType ?? null,
    },
  }));

  if (result?.duplicate) {
    rows.push(normalized(base, 'replay', {
      stage: 'REPLAY',
      operation: 'duplicate_source_event',
      status: 'SKIPPED',
      summary: 'Duplicate/replayed source event did not create a new action.',
      details: { recoveryReady: Boolean(result?.recoveryReady) },
    }));
  }

  if (result?.interpretation) {
    const ai = aiDiagnostics(result.interpretation);
    rows.push(normalized(base, 'interpretation', {
      stage: 'INTERPRETATION',
      operation: 'interpret_event',
      status: statusForInterpretation(result.interpretation),
      errorCode: text(result.interpretation?.reason),
      summary: `Interpretation ${String(result.interpretation?.status ?? 'unknown').toLowerCase()}.`,
      details: {
        status: result.interpretation?.status ?? null,
        source: result.interpretation?.source ?? null,
        ...(ai ? { aiDiagnostics: ai } : {}),
      },
    }));

    const attempts = ai?.attempts;
    if (Array.isArray(attempts)) {
      attempts.forEach((attempt, index) => {
        const rawStatus = String(attempt?.status ?? attempt?.outcome ?? '').toUpperCase();
        const mappedStatus = rawStatus === 'SUCCEEDED' || rawStatus === 'SUCCESS'
          ? 'SUCCEEDED'
          : rawStatus === 'FAILED' || rawStatus === 'FAILURE'
            ? 'FAILED'
            : attempt?.retryable
              ? 'RETRYABLE'
              : 'INFO';
        rows.push(normalized(base, `ai:${index + 1}`, {
          stage: 'AI_PROVIDER',
          operation: 'provider_attempt',
          status: mappedStatus,
          aiProviderId: text(attempt?.providerId ?? attempt?.provider_id),
          errorCode: text(attempt?.providerCode ?? attempt?.errorCode ?? attempt?.code),
          retryable: attempt?.retryable == null ? null : Boolean(attempt.retryable),
          summary: 'AI provider attempt.',
          details: attempt,
        }));
      });
    }
  }

  if (simulation) {
    rows.push(normalized(base, 'broker-planning', {
      stage: 'BROKER_PLANNING',
      operation: 'plan_execution',
      status: statusForSimulation(simulation),
      errorCode: text(simulation?.errorCode ?? simulation?.reason),
      summary: `Broker planning ${String(simulation?.status ?? 'unknown').toLowerCase()}.`,
      details: {
        status: simulation?.status ?? null,
        executionEnabled: simulation?.executionEnabled ?? null,
        actionCount: Array.isArray(simulation?.actions) ? simulation.actions.length : 0,
        correlationReason: simulation?.correlation?.reason ?? null,
      },
    }));

    simulationAccounts(simulation).forEach((account, accountIndex) => {
      const accountId = text(account?.accountId ?? account?.account_id);
      const skips = Array.isArray(account?.protectionSkips) ? account.protectionSkips : [];
      skips.forEach((skip, skipIndex) => {
        rows.push(normalized(base, `protection-skip:${accountId || accountIndex + 1}:${skipIndex + 1}`, {
          stage: 'BROKER_PLANNING',
          operation: 'skip_invalid_protection',
          status: 'SKIPPED',
          tradeAccountId: accountId,
          errorCode: text(skip?.code),
          summary: 'Invalid protective field was skipped by configured policy.',
          details: {
            accountId,
            field: skip?.field ?? null,
            targetIndex: skip?.targetIndex ?? null,
            value: skip?.value ?? null,
          },
        }));
      });
    });

    const correlationReason = text(simulation?.correlation?.reason);
    const isEditManagement = correlationReason === 'EDIT_TARGET';
    const isManagement = String(result?.interpretation?.status ?? '').toUpperCase() === 'MANAGEMENT';
    if (isEditManagement || isManagement) {
      const actions = flattenedSimulationActions(simulation);
      const accountIds = simulationAccounts(simulation)
        .map((account) => text(account?.accountId ?? account?.account_id))
        .filter(Boolean);
      const groupId = text(
        simulation?.correlation?.groupId
          ?? simulation?.correlation?.group_id
          ?? simulationAccounts(simulation).find((account) => account?.groupId ?? account?.group_id)?.groupId
          ?? simulationAccounts(simulation).find((account) => account?.groupId ?? account?.group_id)?.group_id,
      );
      rows.push(normalized(base, isEditManagement ? 'management:edit' : 'management:command', {
        stage: 'MANAGEMENT',
        operation: isEditManagement ? 'source_edit_management' : 'management_command',
        status: managementEvidenceStatus(simulation),
        positionGroupId: groupId,
        summary: isEditManagement ? 'Source edit applied as management.' : 'Management command correlated to an existing trade.',
        details: {
          correlationReason,
          accountIds,
          actionTypes: [...new Set(actions.map((action) => text(action?.type)).filter(Boolean))],
          actionCount: actions.length,
        },
      }));
    }
  }

  if (execution) {
    rows.push(normalized(base, 'broker-execution', {
      stage: 'BROKER_EXECUTION',
      operation: 'execute_plan',
      status: statusForExecution(execution),
      errorCode: text(execution?.errorCode ?? execution?.reason),
      retryable: execution?.retryable == null ? null : Boolean(execution.retryable),
      summary: `Broker execution ${String(execution?.status ?? 'unknown').toLowerCase()}.`,
      details: {
        status: execution?.status ?? null,
        executionEnabled: execution?.executionEnabled ?? null,
        succeeded: execution?.succeeded ?? null,
        failed: execution?.failed ?? null,
      },
    }));
  }

  if (destinations) {
    rows.push(normalized(base, 'destination', {
      stage: 'DESTINATION',
      operation: 'deliver_destinations',
      status: statusForDestination(destinations),
      errorCode: text(destinations?.errorCode),
      summary: `Destination delivery ${String(destinations?.status ?? 'unknown').toLowerCase()}.`,
      details: {
        status: destinations?.status ?? null,
        succeeded: destinations?.succeeded ?? 0,
        failed: destinations?.failed ?? 0,
        rejected: destinations?.rejected ?? 0,
        blocked: destinations?.blocked ?? 0,
        outcomes: Array.isArray(destinations?.outcomes) ? destinations.outcomes : [],
      },
    }));
  }

  return rows.map(({ prefix, ...row }) => row);
}

export async function appendV1LifecycleEvidenceBestEffort(journal, rows = []) {
  if (!journal?.append || !Array.isArray(rows) || rows.length === 0) return { attempted: 0, succeeded: 0, failed: 0 };
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await journal.append(row);
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: rows.length, succeeded, failed };
}
