import { normalizeInstrumentKey, resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';

const MAX_CATALOG_SIZE = 2000;
const MAX_ALIASES_PER_SYMBOL = 24;

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeAliases(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const text = clean(item);
    if (!text) continue;
    const key = normalizeInstrumentKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_ALIASES_PER_SYMBOL) break;
  }
  return out;
}

export function sanitizeAccountSymbolCatalog(input = []) {
  if (!Array.isArray(input)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const platformSymbol = clean(raw.platformSymbol ?? raw.symbol ?? raw.name);
    if (!platformSymbol) continue;
    const exactKey = platformSymbol.toUpperCase();
    if (seen.has(exactKey)) continue;
    seen.add(exactKey);
    const item = {
      platformSymbol,
      ...(clean(raw.canonical) ? { canonical: clean(raw.canonical) } : {}),
      ...(clean(raw.description) ? { description: clean(raw.description).slice(0, 240) } : {}),
      aliases: safeAliases(raw.aliases),
      ...(typeof raw.tradable === 'boolean' ? { tradable: raw.tradable } : {}),
    };
    for (const [target, source] of [
      ['minVolume', raw.minVolume ?? raw.volumeMin ?? raw.volume_in_units_min],
      ['maxVolume', raw.maxVolume ?? raw.volumeMax ?? raw.volume_in_units_max],
      ['stepVolume', raw.stepVolume ?? raw.volumeStep ?? raw.volume_in_units_step],
      ['minLots', raw.minLots ?? raw.minVolume ?? raw.volumeMin],
      ['maxLots', raw.maxLots ?? raw.maxVolume ?? raw.volumeMax],
      ['stepLots', raw.stepLots ?? raw.stepVolume ?? raw.volumeStep],
      ['lotSize', raw.lotSize],
      ['protocolLotSize', raw.protocolLotSize],
      ['tickSize', raw.tickSize],
      ['tickValue', raw.tickValue ?? raw.tickValuePerLot],
      ['tickValueLoss', raw.tickValueLoss ?? raw.tickValueLossPerLot],
      ['tickValueProfit', raw.tickValueProfit ?? raw.tickValueProfitPerLot],
      ['contractSize', raw.contractSize],
      ['pipSize', raw.pipSize],
      ['digits', raw.digits],
    ]) {
      const numeric = finiteOrNull(source);
      if (numeric !== null) item[target] = numeric;
    }
    for (const key of ['currencyBase', 'currencyProfit', 'currencyMargin']) {
      const value = clean(raw[key]);
      if (value) item[key] = value.slice(0, 32);
    }
    result.push(item);
    if (result.length >= MAX_CATALOG_SIZE) break;
  }
  return result;
}

export function mergeAccountSymbolAliases(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  for (const [alias, target] of Object.entries(input)) {
    const aliasKey = normalizeInstrumentKey(alias);
    const targetSymbol = clean(target);
    if (!aliasKey || !targetSymbol) continue;
    out[aliasKey] = targetSymbol;
  }
  return out;
}

function exactPlatformMatch(requested, catalog) {
  const text = clean(requested).toUpperCase();
  if (!text) return [];
  return catalog.filter((item) => clean(item.platformSymbol).toUpperCase() === text);
}

export function resolveAccountSymbol(requested, catalog = [], aliases = {}) {
  const safeCatalog = sanitizeAccountSymbolCatalog(catalog).filter((item) => item.tradable !== false);
  const exact = exactPlatformMatch(requested, safeCatalog);
  if (exact.length === 1) return { ok: true, ...exact[0], matchType: 'exact_platform' };
  if (exact.length > 1) return { ok: false, reason: 'AMBIGUOUS_SYMBOL', candidates: exact.map((item) => item.platformSymbol) };

  const aliasMap = mergeAccountSymbolAliases(aliases);
  const requestedKey = normalizeInstrumentKey(requested);
  const aliasTarget = aliasMap[requestedKey];
  if (aliasTarget) {
    const target = exactPlatformMatch(aliasTarget, safeCatalog);
    if (target.length === 1) return { ok: true, ...target[0], matchType: 'explicit_alias' };
    if (target.length > 1) return { ok: false, reason: 'AMBIGUOUS_SYMBOL', candidates: target.map((item) => item.platformSymbol) };
    return { ok: false, reason: 'SYMBOL_ALIAS_TARGET_NOT_FOUND', candidates: [] };
  }

  const resolved = resolveSymbolAgainstCatalog(requested, safeCatalog);
  return resolved.ok ? { ...resolved, matchType: 'catalog' } : resolved;
}

export function accountSymbolCatalogFromProviderConfig(providerConfig = {}) {
  const config = providerConfig && typeof providerConfig === 'object' && !Array.isArray(providerConfig) ? providerConfig : {};
  return {
    catalog: sanitizeAccountSymbolCatalog(config.symbolCatalog ?? config.symbol_catalog ?? []),
    aliases: mergeAccountSymbolAliases(config.symbolAliases ?? config.symbol_aliases ?? {}),
    updatedAt: clean(config.symbolCatalogUpdatedAt ?? config.symbol_catalog_updated_at) || null,
  };
}

export function providerConfigWithSymbolCatalog(providerConfig = {}, catalog = [], { updatedAt = new Date().toISOString() } = {}) {
  const config = providerConfig && typeof providerConfig === 'object' && !Array.isArray(providerConfig) ? providerConfig : {};
  return {
    ...config,
    symbolCatalog: sanitizeAccountSymbolCatalog(catalog),
    symbolCatalogUpdatedAt: String(updatedAt),
  };
}
