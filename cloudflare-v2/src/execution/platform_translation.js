import { normalizePrice, normalizeVolumeForMT5, normalizeVolumeForCTrader } from '../normalization/trading_normalizer.js';
import { buildNewOrderMessage } from '../adapters/ctrader_protocol.js';

function entryValue(action) {
  if (action?.entry?.kind === 'PRICE') return action.entry.value;
  if (Number.isFinite(Number(action?.entryPrice))) return Number(action.entryPrice);
  return undefined;
}

export function buildMT5OrderCommand(action, symbol) {
  if (!symbol?.platformSymbol) throw new TypeError('resolved MT5 symbol required');
  const priceOptions = { digits: symbol.digits, tickSize: symbol.tickSize };

  return {
    type: action.type,
    symbol: symbol.platformSymbol,
    side: action.side,
    orderType: action.orderType,
    volume: normalizeVolumeForMT5(action.lots, {
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

  return buildNewOrderMessage({
    clientMsgId,
    accountId,
    symbolId: symbol.platformId,
    side: action.side,
    orderType: action.orderType,
    protocolVolume: normalizeVolumeForCTrader(action.lots, {
      lotSize: symbol.lotSize,
      minVolume: symbol.minVolume,
      maxVolume: symbol.maxVolume,
      stepVolume: symbol.stepVolume,
    }),
    ...(entryPrice != null ? { entryPrice: normalizePrice(entryPrice, priceOptions) } : {}),
    ...(action.stopLoss != null ? { stopLoss: normalizePrice(action.stopLoss, priceOptions) } : {}),
    ...(action.takeProfit != null ? { takeProfit: normalizePrice(action.takeProfit, priceOptions) } : {}),
  });
}
