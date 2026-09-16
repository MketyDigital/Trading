import {
  normalizePrice,
  normalizeVolumeForCTrader,
  validateVolumeForMT5Execution,
  validateVolumeForCTraderExecution,
} from '../normalization/trading_normalizer.js';
import {
  buildNewOrderMessage,
  buildAmendPositionSLTPMessage,
  buildClosePositionMessage,
  buildCancelOrderMessage,
} from '../adapters/ctrader_protocol.js';

function entryValue(action) {
  if (action?.entry?.kind === 'PRICE') return action.entry.value;
  if (Number.isFinite(Number(action?.entryPrice))) return Number(action.entryPrice);
  return undefined;
}

function boundedCTraderClientMsgId(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError('cTrader clientMsgId required');
  if (text.length <= 64) return text;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = (hash >>> 0).toString(16).padStart(8, '0');
  return `${text.slice(0, 55)}${suffix}`;
}

function cTraderVolumeOptions(symbol = {}) {
  return {
    protocolLotSize: symbol.protocolLotSize,
    lotSize: symbol.lotSize,
    minVolume: symbol.minVolume,
    maxVolume: symbol.maxVolume,
    stepVolume: symbol.stepVolume,
  };
}

export function buildMT5OrderCommand(action, symbol) {
  if (!symbol?.platformSymbol) throw new TypeError('resolved MT5 symbol required');
  const priceOptions = { digits: symbol.digits, tickSize: symbol.tickSize };

  return {
    type: action.type,
    symbol: symbol.platformSymbol,
    side: action.side,
    orderType: action.orderType,
    volume: validateVolumeForMT5Execution(action.lots, {
      min: symbol.minLots,
      max: symbol.maxLots,
      step: symbol.stepLots,
    }),
    ...(entryValue(action) != null ? { entryPrice: normalizePrice(entryValue(action), priceOptions) } : {}),
    ...(action.stopLoss != null ? { stopLoss: normalizePrice(action.stopLoss, priceOptions) } : {}),
    ...(action.takeProfit != null ? { takeProfit: normalizePrice(action.takeProfit, priceOptions) } : {}),
  };
}

export function buildCTraderOrderCommand(action, { accountId, clientMsgId, symbol }) {
  if (!symbol?.platformId) throw new TypeError('resolved cTrader symbolId required');
  const priceOptions = { digits: symbol.digits, tickSize: symbol.tickSize };
  const entryPrice = entryValue(action);
  const isMarket = action.orderType === 'MARKET';

  return buildNewOrderMessage({
    clientMsgId: boundedCTraderClientMsgId(clientMsgId),
    accountId,
    symbolId: symbol.platformId,
    side: action.side,
    orderType: action.orderType,
    protocolVolume: validateVolumeForCTraderExecution(action.lots, cTraderVolumeOptions(symbol)),
    ...(entryPrice != null ? { entryPrice: normalizePrice(entryPrice, priceOptions) } : {}),
    // cTrader does not accept absolute stopLoss/takeProfit on MARKET new-order
    // requests. The executor applies them via 2110 after position creation.
    ...(!isMarket && action.stopLoss != null ? { stopLoss: normalizePrice(action.stopLoss, priceOptions) } : {}),
    ...(!isMarket && action.takeProfit != null ? { takeProfit: normalizePrice(action.takeProfit, priceOptions) } : {}),
    ...(action.idempotencyKey ? { clientOrderId: action.idempotencyKey } : {}),
    ...(action.label ? { label: action.label } : {}),
    ...(action.comment ? { comment: action.comment } : {}),
  });
}

export function buildMT5ManagementCommand(action, symbol = {}) {
  const priceOptions = { digits: symbol.digits, tickSize: symbol.tickSize };

  if (action.type === 'MODIFY_POSITION') {
    if (action.brokerPositionId == null) throw new TypeError('brokerPositionId required');
    return {
      action: 'MODIFY_POSITION',
      positionId: String(action.brokerPositionId),
      ...(action.clearStopLoss === true ? { stopLoss: 0 } : action.stopLoss != null ? { stopLoss: normalizePrice(action.stopLoss, priceOptions) } : {}),
      ...(action.clearTakeProfit === true ? { takeProfit: 0 } : action.takeProfit != null ? { takeProfit: normalizePrice(action.takeProfit, priceOptions) } : {}),
    };
  }

  if (action.type === 'CLOSE_POSITION') {
    if (action.brokerPositionId == null) throw new TypeError('brokerPositionId required');
    return { action: 'CLOSE_POSITION', positionId: String(action.brokerPositionId) };
  }

  if (action.type === 'CLOSE_PARTIAL') {
    if (action.brokerPositionId == null) throw new TypeError('brokerPositionId required');
    return {
      action: 'CLOSE_PARTIAL',
      positionId: String(action.brokerPositionId),
      volume: validateVolumeForMT5Execution(action.lots, {
        min: symbol.minLots,
        max: symbol.maxLots,
        step: symbol.stepLots,
      }),
    };
  }

  if (action.type === 'CANCEL_PENDING') {
    if (action.brokerOrderId == null) throw new TypeError('brokerOrderId required');
    return { action: 'CANCEL_PENDING', orderId: String(action.brokerOrderId) };
  }

  throw new TypeError(`unsupported MT5 management action: ${action.type}`);
}

export function buildCTraderManagementCommand(action, { accountId, clientMsgId, symbol = {} }) {
  const boundedClientMsgId = boundedCTraderClientMsgId(clientMsgId);
  if (action.type === 'MODIFY_POSITION') {
    return buildAmendPositionSLTPMessage({
      clientMsgId: boundedClientMsgId,
      accountId,
      positionId: action.brokerPositionId,
      ...(action.clearStopLoss === true ? { stopLoss: 0 } : action.stopLoss != null ? { stopLoss: action.stopLoss } : {}),
      ...(action.clearTakeProfit === true ? { takeProfit: 0 } : action.takeProfit != null ? { takeProfit: action.takeProfit } : {}),
    });
  }

  if (action.type === 'CLOSE_POSITION') {
    const lots = action.lots;
    if (!(Number(lots) > 0)) throw new TypeError('lots required for cTrader close action');
    return buildClosePositionMessage({
      clientMsgId: boundedClientMsgId,
      accountId,
      positionId: action.brokerPositionId,
      protocolVolume: normalizeVolumeForCTrader(lots, cTraderVolumeOptions(symbol)),
    });
  }

  if (action.type === 'CLOSE_PARTIAL') {
    const lots = action.lots;
    if (!(Number(lots) > 0)) throw new TypeError('lots required for cTrader close action');
    return buildClosePositionMessage({
      clientMsgId: boundedClientMsgId,
      accountId,
      positionId: action.brokerPositionId,
      protocolVolume: validateVolumeForCTraderExecution(lots, cTraderVolumeOptions(symbol)),
    });
  }

  if (action.type === 'CANCEL_PENDING') {
    return buildCancelOrderMessage({
      clientMsgId: boundedClientMsgId,
      accountId,
      orderId: action.brokerOrderId,
    });
  }

  throw new TypeError(`unsupported cTrader management action: ${action.type}`);
}
