const ORDER_TYPES = Object.freeze({ MARKET: 1, LIMIT: 2, STOP: 3, STOP_LIMIT: 6 });
const SIDES = Object.freeze({ BUY: 1, SELL: 2 });

export function ctraderEndpoint(environment = 'demo', protocol = 'json') {
  const host = environment === 'live' ? 'live.ctraderapi.com' : 'demo.ctraderapi.com';
  const port = protocol === 'protobuf' ? 5035 : 5036;
  return `wss://${host}:${port}`;
}

export function buildApplicationAuthMessage(clientId, clientSecret, clientMsgId) {
  return { clientMsgId, payloadType: 2100, payload: { clientId, clientSecret } };
}

export function buildAccountAuthMessage(ctidTraderAccountId, accessToken, clientMsgId) {
  return { clientMsgId, payloadType: 2102, payload: { ctidTraderAccountId, accessToken } };
}

export function buildNewOrderMessage({ clientMsgId, accountId, symbolId, side, orderType, protocolVolume, entryPrice, stopPrice, stopLoss, takeProfit, timeInForce }) {
  if (!Number.isInteger(Number(accountId))) throw new TypeError('accountId is required');
  if (!Number.isInteger(Number(symbolId))) throw new TypeError('symbolId is required');
  if (!ORDER_TYPES[orderType]) throw new TypeError('unsupported cTrader order type');
  if (!SIDES[side]) throw new TypeError('unsupported cTrader side');
  const payload = {
    ctidTraderAccountId: Number(accountId),
    symbolId: Number(symbolId),
    orderType: ORDER_TYPES[orderType],
    tradeSide: SIDES[side],
    volume: Math.trunc(protocolVolume),
  };
  if (orderType === 'LIMIT' && entryPrice != null) payload.limitPrice = Number(entryPrice);
  if ((orderType === 'STOP' || orderType === 'STOP_LIMIT') && (stopPrice ?? entryPrice) != null) payload.stopPrice = Number(stopPrice ?? entryPrice);
  if (stopLoss != null) payload.stopLoss = Number(stopLoss);
  if (takeProfit != null) payload.takeProfit = Number(takeProfit);
  if (timeInForce != null) payload.timeInForce = timeInForce;
  return { clientMsgId, payloadType: 2106, payload };
}
