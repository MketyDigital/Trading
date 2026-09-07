import { buildTraderMessage, buildSymbolsListMessage, buildSymbolByIdMessage, buildSubscribeSpotsMessage, decodeSpotEvent } from './ctrader_protocol.js';
import { fromCTraderSymbols } from '../normalization/symbol_catalog.js';
import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';

const ACCOUNT_TYPES = Object.freeze({ 0: 'HEDGED', 1: 'NETTED', 2: 'SPREAD_BETTING' });
const ACCESS_RIGHTS = Object.freeze({ 0: 'FULL_ACCESS', 1: 'CLOSE_ONLY', 2: 'NO_TRADING', 3: 'NO_LOGIN' });

export class CTraderMarketData {
  constructor({ session, accountId } = {}) {
    if (!session) throw new TypeError('session is required');
    if (!Number.isInteger(Number(accountId))) throw new TypeError('accountId is required');
    this.session = session;
    this.accountId = Number(accountId);
    this.catalog = [];
    this.quotes = new Map();
    this.account = null;
  }

  async loadAccount() {
    const message = buildTraderMessage({ clientMsgId: this.session.nextClientMsgId('trader'), accountId: this.accountId });
    const response = await this.session.request(message, { successPayloadTypes: [2122] });
    const trader = response?.payload?.trader || response?.payload || {};
    const accountType = ACCOUNT_TYPES[Number(trader.accountType)] || 'UNKNOWN';
    const accessRights = ACCESS_RIGHTS[Number(trader.accessRights)] || 'UNKNOWN';
    this.account = {
      accountId: Number(trader.ctidTraderAccountId ?? this.accountId),
      accountType,
      accessRights,
      isLimitedRisk: Boolean(trader.isLimitedRisk),
      canOpenTrades: accessRights === 'FULL_ACCESS',
      raw: trader,
    };
    return this.account;
  }

  async loadCatalog() {
    const list = await this.session.request(buildSymbolsListMessage({
      clientMsgId: this.session.nextClientMsgId('symbols'), accountId: this.accountId,
    }), { successPayloadTypes: [2115] });
    const light = Array.isArray(list?.payload?.symbol) ? list.payload.symbol.filter((s) => s.enabled !== false) : [];
    const ids = light.map((s) => Number(s.symbolId)).filter(Number.isInteger);
    if (!ids.length) { this.catalog = []; return this.catalog; }
    const details = await this.session.request(buildSymbolByIdMessage({
      clientMsgId: this.session.nextClientMsgId('symbol-detail'), accountId: this.accountId, symbolIds: ids,
    }), { successPayloadTypes: [2117] });
    const fullById = new Map((details?.payload?.symbol || []).map((s) => [Number(s.symbolId), s]));
    this.catalog = fromCTraderSymbols(light.map((l) => ({ ...l, ...(fullById.get(Number(l.symbolId)) || {}) })));
    return this.catalog;
  }

  async subscribeQuotes(symbolIds) {
    return this.session.request(buildSubscribeSpotsMessage({
      clientMsgId: this.session.nextClientMsgId('spot'), accountId: this.accountId, symbolIds,
    }), { successPayloadTypes: [2128] });
  }

  handleSpotEvent(message) {
    const id = Number(message?.payload?.symbolId);
    const symbol = this.catalog.find((s) => Number(s.platformId) === id);
    if (!symbol) return null;
    const decoded = decodeSpotEvent(message, { digits: symbol.digits });
    const current = this.quotes.get(id) || {};
    const next = { ...current, ...(decoded.bid != null ? { bid: decoded.bid } : {}), ...(decoded.ask != null ? { ask: decoded.ask } : {}), ...(decoded.timestamp != null ? { timestamp: decoded.timestamp } : {}) };
    this.quotes.set(id, next);
    return next;
  }

  quoteFor(symbolId) { return this.quotes.get(Number(symbolId)) || null; }

  marketPriceFor(symbolValue, side) {
    const resolved = resolveSymbolAgainstCatalog(symbolValue, this.catalog);
    if (!resolved.ok) return null;
    const quote = this.quoteFor(resolved.platformId);
    if (!quote) return null;
    return String(side).toUpperCase() === 'SELL' ? quote.bid ?? null : quote.ask ?? null;
  }
}
