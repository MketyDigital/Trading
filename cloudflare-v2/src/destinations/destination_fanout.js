import { renderTelegramDestination } from './telegram_presentation.js';

function text(value) {
  return String(value ?? '').trim();
}

function safeMark(latencyTrace, name) {
  try {
    latencyTrace?.mark?.(name);
  } catch {
    // Destination telemetry is observational only and must never block delivery.
  }
}

function workspaceOf(destination = {}) {
  return text(destination.workspaceId ?? destination.workspace_id);
}

function destinationIdOf(destination = {}) {
  return text(destination.id ?? destination.destinationId ?? destination.destination_id);
}

function destinationTypeOf(destination = {}) {
  return text(destination.type ?? destination.destinationType ?? destination.destination_type).toLowerCase();
}

function safeSuccessResult(result = {}) {
  const output = {};
  if (result?.deliveryRef != null) output.deliveryRef = String(result.deliveryRef);
  if (result?.delivery_ref != null && output.deliveryRef == null) output.deliveryRef = String(result.delivery_ref);
  if (result?.duplicate === true) output.duplicate = true;
  return output;
}

function rejectedOutcome(destinationId, reason) {
  return {
    destinationId,
    status: 'REJECTED',
    errorCode: reason,
  };
}

async function dispatchOne({ workspaceId, destination, event, dispatch, aiFormatter, latencyTrace }) {
  const destinationId = destinationIdOf(destination);

  try {
    const input = {
      workspaceId,
      destination,
      event,
    };

    if (destinationTypeOf(destination) === 'telegram') {
      safeMark(latencyTrace, 'DESTINATION_FORMAT_START');
      input.presentation = await renderTelegramDestination({
        canonicalEvent: event,
        destination,
        aiFormatter,
        timeoutMs: destination?.presentation?.aiTimeoutMs,
      });
      safeMark(latencyTrace, 'DESTINATION_FORMAT_DONE');
    }

    const result = await dispatch(input);
    if (destinationTypeOf(destination) === 'telegram') {
      safeMark(latencyTrace, 'DESTINATION_ACK');
    }

    if (result?.success === false || result?.ok === false) {
      return {
        destinationId,
        status: 'FAILED',
        errorCode: 'DESTINATION_DISPATCH_FAILED',
      };
    }

    return {
      destinationId,
      status: 'SUCCEEDED',
      ...safeSuccessResult(result),
    };
  } catch {
    return {
      destinationId,
      status: 'FAILED',
      errorCode: 'DESTINATION_DISPATCH_FAILED',
    };
  }
}

export async function dispatchDestinationFanout({
  workspaceId,
  destinations = [],
  event,
  dispatch,
  aiFormatter,
  latencyTrace,
} = {}) {
  const trustedWorkspaceId = text(workspaceId);
  if (!trustedWorkspaceId) throw new TypeError('workspaceId is required');
  if (!Array.isArray(destinations)) throw new TypeError('destinations must be an array');
  if (typeof dispatch !== 'function') throw new TypeError('dispatch is required');

  const seenIds = new Set();
  const tasks = destinations.map((destination) => {
    const destinationId = destinationIdOf(destination);

    if (!destinationId) {
      return Promise.resolve(rejectedOutcome('', 'DESTINATION_ID_REQUIRED'));
    }

    if (seenIds.has(destinationId)) {
      return Promise.resolve(rejectedOutcome(destinationId, 'DUPLICATE_DESTINATION_ID'));
    }
    seenIds.add(destinationId);

    const destinationWorkspaceId = workspaceOf(destination);
    if (!destinationWorkspaceId || destinationWorkspaceId !== trustedWorkspaceId) {
      return Promise.resolve(rejectedOutcome(destinationId, 'DESTINATION_WORKSPACE_MISMATCH'));
    }

    return dispatchOne({
      workspaceId: trustedWorkspaceId,
      destination,
      event,
      dispatch,
      aiFormatter,
      latencyTrace,
    });
  });

  const outcomes = await Promise.all(tasks);
  const succeeded = outcomes.filter((item) => item.status === 'SUCCEEDED').length;
  const failed = outcomes.filter((item) => item.status === 'FAILED').length;
  const rejected = outcomes.filter((item) => item.status === 'REJECTED').length;

  return {
    ok: failed === 0 && rejected === 0,
    succeeded,
    failed,
    rejected,
    outcomes,
  };
}
