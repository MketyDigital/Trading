function asCount(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function dueAt(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(date) {
  return date.toISOString();
}

function backoffMs(attempt, baseBackoffMs, maxBackoffMs) {
  return Math.min(maxBackoffMs, baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
}

function isHealthy(status = {}) {
  return Boolean(status.running)
    && !['ERROR', 'DEGRADED', 'STOPPED', 'DISABLED'].includes(String(status.status || '').toUpperCase());
}

export function createMtprotoRecoverySupervisor({
  lifecycle,
  store,
  now = () => new Date(),
  maxAttempts = 5,
  baseBackoffMs = 5000,
  maxBackoffMs = 300000,
} = {}) {
  if (!lifecycle?.status || !lifecycle?.restart) {
    throw new TypeError('MTProto lifecycle service is required');
  }
  if (!store?.listRecoverableSources || !store?.updateRecoveryState) {
    throw new TypeError('MTProto recovery store is required');
  }

  const boundedMaxAttempts = Math.max(1, Number(maxAttempts) || 1);
  const boundedBaseBackoffMs = Math.max(1, Number(baseBackoffMs) || 1);
  const boundedMaxBackoffMs = Math.max(boundedBaseBackoffMs, Number(maxBackoffMs) || boundedBaseBackoffMs);

  return {
    async run() {
      const sources = await store.listRecoverableSources();
      const summary = {
        checked: sources.length,
        healthy: 0,
        restarted: 0,
        failed: 0,
        backoff: 0,
        exhausted: 0,
      };

      for (const source of sources) {
        const attemptCount = asCount(source.recoveryAttemptCount);
        const clock = now();
        const nextAttemptAt = dueAt(source.recoveryNextAttemptAt);
        const request = {
          workspaceId: String(source.workspaceId),
          sourceId: String(source.id),
        };

        let status = null;
        try {
          status = await lifecycle.status(request);
        } catch {
          // A failed health probe is treated as unhealthy. Durable backoff still
          // decides whether a restart may be attempted, so probe errors cannot
          // bypass an existing retry window or exhausted state.
        }

        if (isHealthy(status)) {
          summary.healthy += 1;
          if (attemptCount > 0 || nextAttemptAt || source.lastRecoveryErrorCode) {
            await store.updateRecoveryState(request.workspaceId, request.sourceId, {
              recoveryAttemptCount: 0,
              recoveryNextAttemptAt: null,
              lastRecoveryErrorCode: null,
            });
          }
          continue;
        }

        if (attemptCount >= boundedMaxAttempts) {
          summary.exhausted += 1;
          continue;
        }
        if (nextAttemptAt && nextAttemptAt.getTime() > clock.getTime()) {
          summary.backoff += 1;
          continue;
        }

        try {
          const restart = await lifecycle.restart(request);
          if (!restart?.restarted) throw new Error('runtime restart not confirmed');

          summary.restarted += 1;
          await store.updateRecoveryState(request.workspaceId, request.sourceId, {
            recoveryAttemptCount: 0,
            recoveryNextAttemptAt: null,
            lastRecoveryAt: iso(clock),
            lastRecoveryErrorCode: null,
          });
        } catch {
          const nextAttempt = attemptCount + 1;
          const delay = backoffMs(nextAttempt, boundedBaseBackoffMs, boundedMaxBackoffMs);
          summary.failed += 1;
          await store.updateRecoveryState(request.workspaceId, request.sourceId, {
            recoveryAttemptCount: nextAttempt,
            recoveryNextAttemptAt: iso(new Date(clock.getTime() + delay)),
            lastRecoveryAt: iso(clock),
            lastRecoveryErrorCode: 'MTPROTO_RECOVERY_FAILED',
          });
        }
      }

      return summary;
    },
  };
}
