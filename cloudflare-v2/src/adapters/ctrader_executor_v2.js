import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';
import { buildCTraderOrderCommand, buildCTraderManagementCommand } from '../execution/platform_translation.js';

const ORDER_ACCEPTED = 2;
const ORDER_FILLED = 3;
const ORDER_PARTIAL_FILL = 11;

function extractBrokerIds(message) {
  const payload = message?.payload || {};
  return {
    brokerPositionId: payload.position?.positionId ?? payload.deal?.positionId ?? null,
    brokerOrderId: payload.order?.orderId ?? payload.deal?.orderId ?? null,
    brokerDealId: payload.deal?.dealId ?? null,
  };
}

function extractFillPrice(message) {
  const payload = message?.payload || {};
  const candidate = payload.deal?.executionPrice ?? payload.position?.price ?? payload.order?.executionPrice;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

async function reserveAction(deliveryStore, action) {
  if (!action.idempotencyKey) throw new TypeError('idempotencyKey required for cTrader execution');
  const reservation = await deliveryStore.reserve(action.idempotencyKey, {
    destinationType: 'ctrader',
    action,
  });
  if (reservation?.duplicate) return { duplicate: true, previous: reservation.result ?? null };
  if (!reservation?.ok) throw new Error('failed to reserve cTrader delivery idempotency');
  return { duplicate: false, reservation };
}

function resolveCTraderSymbol(action, catalog) {
  const symbolName = action.symbol;
  if (!symbolName) return null;
  const resolved = resolveSymbolAgainstCatalog(symbolName, catalog);
  if (!resolved.ok) throw new Error(`cTrader symbol resolution failed: ${resolved.reason}`);
  return resolved;
}

function executionType(message) {
  return Number(message?.payload?.executionType);
}

function isFilledExecution(message) {
  const type = executionType(message);
  return (type === ORDER_FILLED || type === ORDER_PARTIAL_FILL) && Boolean(extractBrokerIds(message).brokerPositionId);
}

function sameBrokerOrder(message, { brokerOrderId, clientOrderId }) {
  const payload = message?.payload || {};
  const messageOrderId = payload.order?.orderId ?? payload.deal?.orderId;
  const messageClientOrderId = payload.order?.clientOrderId;
  if (brokerOrderId != null && messageOrderId != null && String(messageOrderId) === String(brokerOrderId)) return true;
  if (clientOrderId && messageClientOrderId && String(messageClientOrderId) === String(clientOrderId)) return true;
  return false;
}

function classifiedError(message, deliveryFailureClass, code, cause = null) {
  const error = new Error(String(message || code || 'cTrader execution failed'), cause ? { cause } : undefined);
  error.deliveryFailureClass = deliveryFailureClass;
  error.code = code;
  return error;
}

async function resolveMarketFill(session, acceptedResponse, action) {
  if (isFilledExecution(acceptedResponse)) return acceptedResponse;
  if (!session?.waitForEvent) {
    throw classifiedError('cTrader session cannot wait for market fill event', 'UNCERTAIN', 'CTRADER_FILL_STATUS_UNCERTAIN');
  }

  const acceptedIds = extractBrokerIds(acceptedResponse);
  const clientOrderId = String(action.idempotencyKey);
  const type = executionType(acceptedResponse);
  if (type !== ORDER_ACCEPTED && !acceptedIds.brokerOrderId) {
    throw classifiedError('cTrader market order response did not provide an accepted order or fill', 'UNCERTAIN', 'CTRADER_FILL_STATUS_UNCERTAIN');
  }

  try {
    return await session.waitForEvent((message) => {
      if (Number(message?.payloadType) !== 2126) return false;
      if (!isFilledExecution(message)) return false;
      return sameBrokerOrder(message, {
        brokerOrderId: acceptedIds.brokerOrderId,
        clientOrderId,
      });
    });
  } catch (error) {
    if (error?.deliveryFailureClass) throw error;
    throw classifiedError(error?.message || 'cTrader fill status is uncertain', 'UNCERTAIN', 'CTRADER_FILL_STATUS_UNCERTAIN', error);
  }
}

async function persistFailure(deliveryStore, idempotencyKey, error, { nowMs, retryDelayMs }) {
  const failure = { code: error?.code || 'CTRADER_EXECUTION_FAILED', error: error?.message || 'cTrader execution failed' };
  if (error?.deliveryFailureClass === 'RETRYABLE') {
    if (!deliveryStore?.markRetryable) throw new Error('deliveryStore markRetryable required for retryable cTrader outcome');
    await deliveryStore.markRetryable(idempotencyKey, failure, {
      nextAttemptAt: new Date(Number(nowMs) + Number(retryDelayMs)).toISOString(),
    });
    return;
  }
  if (error?.deliveryFailureClass === 'UNCERTAIN') {
    if (!deliveryStore?.markUncertain) throw new Error('deliveryStore markUncertain required for uncertain cTrader outcome');
    await deliveryStore.markUncertain(idempotencyKey, failure);
    return;
  }
  await deliveryStore.fail(idempotencyKey, failure);
}

export async function executeCTraderAction(action, {
  session,
  accountId,
  catalog = [],
  deliveryStore,
  label = 'Mkety Trading',
  nowMs = Date.now(),
  retryDelayMs = 15000,
} = {}) {
  if (!session?.request) throw new TypeError('cTrader session required');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) {
    throw new TypeError('deliveryStore reserve/complete/fail required');
  }

  const reserved = await reserveAction(deliveryStore, action);
  if (reserved.duplicate) return { duplicate: true, ...(reserved.previous || {}) };

  const clientMsgId = String(action.idempotencyKey);
  const symbol = resolveCTraderSymbol(action, catalog);
  let brokerAccepted = false;

  try {
    let response;
    if (action.type === 'OPEN_POSITION') {
      const message = buildCTraderOrderCommand({ ...action, label }, {
        accountId,
        clientMsgId,
        symbol,
      });
      response = await session.request(message, { successPayloadTypes: [2126] });
      brokerAccepted = true;

      let executionResponse = response;
      if (action.orderType === 'MARKET') executionResponse = await resolveMarketFill(session, response, action);

      const ids = extractBrokerIds(executionResponse);
      const acceptedIds = extractBrokerIds(response);
      if (!ids.brokerOrderId && acceptedIds.brokerOrderId) ids.brokerOrderId = acceptedIds.brokerOrderId;
      const fillPrice = extractFillPrice(executionResponse);

      if (action.orderType === 'MARKET' && (action.stopLoss != null || action.takeProfit != null)) {
        if (!ids.brokerPositionId) {
          throw classifiedError('cTrader market fill did not provide a position ID', 'UNCERTAIN', 'CTRADER_FILL_STATUS_UNCERTAIN');
        }
        const amend = buildCTraderManagementCommand({
          type: 'MODIFY_POSITION',
          brokerPositionId: ids.brokerPositionId,
          stopLoss: action.stopLoss,
          takeProfit: action.takeProfit,
        }, {
          accountId,
          clientMsgId: `${clientMsgId}:protect`,
          symbol,
        });
        try {
          await session.request(amend, { successPayloadTypes: [2126] });
        } catch (error) {
          if (error?.deliveryFailureClass === 'TERMINAL') throw error;
          throw classifiedError(error?.message || 'cTrader protection status uncertain', 'UNCERTAIN', 'CTRADER_PROTECTION_STATUS_UNCERTAIN', error);
        }
      }

      const result = { duplicate: false, ...ids, fillPrice, response: executionResponse };
      await deliveryStore.complete(action.idempotencyKey, result);
      return result;
    }

    const managementMessage = buildCTraderManagementCommand(action, {
      accountId,
      clientMsgId,
      symbol: symbol || catalog.find((item) => item.platform === 'ctrader') || {},
    });
    response = await session.request(managementMessage, { successPayloadTypes: [2126] });
    brokerAccepted = true;
    const result = { duplicate: false, ...extractBrokerIds(response), response };
    await deliveryStore.complete(action.idempotencyKey, result);
    return result;
  } catch (error) {
    let classified = error;
    if (!classified?.deliveryFailureClass) {
      classified = brokerAccepted
        ? classifiedError(error?.message, 'UNCERTAIN', 'CTRADER_POST_ACCEPT_OUTCOME_UNCERTAIN', error)
        : classifiedError(error?.message, 'TERMINAL', error?.code || 'CTRADER_EXECUTION_REJECTED', error);
    }
    await persistFailure(deliveryStore, action.idempotencyKey, classified, { nowMs, retryDelayMs });
    throw classified;
  }
}
