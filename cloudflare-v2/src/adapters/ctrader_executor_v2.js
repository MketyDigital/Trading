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

async function reserveAction(deliveryStore, action) {
  if (!action.idempotencyKey) throw new TypeError('idempotencyKey required for cTrader execution');
  const reservation = await deliveryStore.reserve(action.idempotencyKey, {
    destinationType: 'ctrader',
    action,
  });
  if (reservation?.duplicate) {
    return { duplicate: true, previous: reservation.result ?? null };
  }
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

async function resolveMarketFill(session, acceptedResponse, action) {
  if (isFilledExecution(acceptedResponse)) return acceptedResponse;
  if (!session?.waitForEvent) {
    throw new Error('cTrader session cannot wait for market fill event');
  }

  const acceptedIds = extractBrokerIds(acceptedResponse);
  const clientOrderId = String(action.idempotencyKey);
  const type = executionType(acceptedResponse);
  if (type !== ORDER_ACCEPTED && !acceptedIds.brokerOrderId) {
    throw new Error('cTrader market order response did not provide an accepted order or fill');
  }

  return session.waitForEvent((message) => {
    if (Number(message?.payloadType) !== 2126) return false;
    if (!isFilledExecution(message)) return false;
    return sameBrokerOrder(message, {
      brokerOrderId: acceptedIds.brokerOrderId,
      clientOrderId,
    });
  });
}

export async function executeCTraderAction(action, {
  session,
  accountId,
  catalog = [],
  deliveryStore,
  label = 'Mkety Trading',
} = {}) {
  if (!session?.request) throw new TypeError('cTrader session required');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) {
    throw new TypeError('deliveryStore reserve/complete/fail required');
  }

  const reserved = await reserveAction(deliveryStore, action);
  if (reserved.duplicate) {
    return { duplicate: true, ...(reserved.previous || {}) };
  }

  const clientMsgId = String(action.idempotencyKey);
  const symbol = resolveCTraderSymbol(action, catalog);

  try {
    let response;
    if (action.type === 'OPEN_POSITION') {
      const message = buildCTraderOrderCommand({ ...action, label }, {
        accountId,
        clientMsgId,
        symbol,
      });
      response = await session.request(message, { successPayloadTypes: [2126] });

      let executionResponse = response;
      if (action.orderType === 'MARKET') {
        executionResponse = await resolveMarketFill(session, response, action);
      }

      const ids = extractBrokerIds(executionResponse);
      const acceptedIds = extractBrokerIds(response);
      if (!ids.brokerOrderId && acceptedIds.brokerOrderId) ids.brokerOrderId = acceptedIds.brokerOrderId;

      // cTrader MARKET orders do not accept absolute SL/TP in ProtoOANewOrderReq.
      // Never report a protected market trade as successful until a fill has
      // produced a real position ID and the protection amend has completed.
      if (action.orderType === 'MARKET' && (action.stopLoss != null || action.takeProfit != null)) {
        if (!ids.brokerPositionId) throw new Error('cTrader market fill did not provide a position ID');
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
        await session.request(amend, { successPayloadTypes: [2126] });
      }

      const result = { duplicate: false, ...ids, response: executionResponse };
      await deliveryStore.complete(action.idempotencyKey, result);
      return result;
    }

    const managementMessage = buildCTraderManagementCommand(action, {
      accountId,
      clientMsgId,
      symbol: symbol || catalog.find((item) => item.platform === 'ctrader') || {},
    });
    response = await session.request(managementMessage, { successPayloadTypes: [2126] });
    const result = { duplicate: false, ...extractBrokerIds(response), response };
    await deliveryStore.complete(action.idempotencyKey, result);
    return result;
  } catch (error) {
    await deliveryStore.fail(action.idempotencyKey, {
      error: error.message,
    });
    throw error;
  }
}
