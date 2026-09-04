import { normalizeSymbol } from './trading_normalizer.js';

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function positiveNumber(...values) {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric != null && numeric > 0) return numeric;
  }
  return undefined;
}

function decimalUnit(position) {
  return Number(`1e-${position}`);
}

export function fromMT5Symbols(symbols = []) {
  return symbols.map((symbol) => ({
    platform: 'mt5',
    platformSymbol: symbol.name,
    canonical: normalizeSymbol(symbol.name).canonical,
    aliases: [symbol.description].filter(Boolean),
    digits: Number.isInteger(symbol.digits) ? symbol.digits : undefined,
    tickSize: finiteNumber(symbol.trade_tick_size),
    // Prefer the loss-side tick value for stop-loss risk. Fall back only to the
    // broker's generic tick value when the loss-specific field is unavailable.
    tickValuePerLot: positiveNumber(symbol.trade_tick_value_loss, symbol.trade_tick_value),
    tickValueProfitPerLot: positiveNumber(symbol.trade_tick_value_profit),
    tickValueLossPerLot: positiveNumber(symbol.trade_tick_value_loss),
    contractSize: finiteNumber(symbol.trade_contract_size),
    lotSize: finiteNumber(symbol.trade_contract_size),
    minLots: finiteNumber(symbol.volume_min),
    maxLots: finiteNumber(symbol.volume_max),
    stepLots: finiteNumber(symbol.volume_step),
    currencyBase: symbol.currency_base,
    currencyProfit: symbol.currency_profit,
    currencyMargin: symbol.currency_margin,
    raw: symbol,
  }));
}

export function fromCTraderSymbols(symbols = []) {
  return symbols.map((symbol) => {
    const protocolLotSize = finiteNumber(symbol.lotSize);
    const digits = Number.isInteger(symbol.digits) ? symbol.digits : undefined;
    const pipPosition = Number.isInteger(symbol.pipPosition) ? symbol.pipPosition : undefined;
    return {
      platform: 'ctrader',
      platformId: finiteNumber(symbol.symbolId),
      platformSymbol: symbol.symbolName,
      canonical: normalizeSymbol(symbol.symbolName).canonical,
      aliases: [symbol.description].filter(Boolean),
      digits,
      pipPosition,
      tickSize: digits == null ? undefined : decimalUnit(digits),
      pipSize: pipPosition == null ? undefined : decimalUnit(pipPosition),
      // cTrader protocol metadata is already expressed in cents.
      protocolLotSize,
      lotSizeUnits: protocolLotSize == null ? undefined : protocolLotSize / 100,
      minVolume: finiteNumber(symbol.minVolume),
      maxVolume: finiteNumber(symbol.maxVolume),
      stepVolume: finiteNumber(symbol.stepVolume),
      maxExposure: finiteNumber(symbol.maxExposure),
      tradingMode: symbol.tradingMode,
      enableShortSelling: symbol.enableShortSelling,
      enabled: symbol.enabled,
      raw: symbol,
    };
  });
}

export function fromDerivActiveSymbols(symbols = []) {
  return symbols.map((symbol) => {
    const platformSymbol = symbol.underlying_symbol || symbol.symbol;
    const displayName = symbol.underlying_symbol_name || symbol.display_name || '';
    return {
      platform: 'deriv',
      platformSymbol,
      canonical: normalizeSymbol(displayName || platformSymbol).canonical,
      aliases: [displayName].filter(Boolean),
      tickSize: finiteNumber(symbol.pip_size ?? symbol.pip),
      marketType: symbol.underlying_symbol_type || symbol.symbol_type,
      raw: symbol,
    };
  });
}
