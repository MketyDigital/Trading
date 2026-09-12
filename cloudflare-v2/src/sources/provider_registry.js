export const SOURCE_FAMILIES = Object.freeze({
  TELEGRAM: 'telegram',
  TRADINGVIEW: 'tradingview',
  MT5: 'mt5',
  CTRADER: 'ctrader',
  CUSTOM_API: 'custom_api',
});

export const PROVIDER_TYPES = Object.freeze({
  CLOUDFLARE_CONTAINER_MTPROTO: 'cloudflare_container_mtproto',
  CLOUDFLARE_DO_MTPROTO: 'cloudflare_do_mtproto',
  EXTERNAL_MTPROTO: 'external_mtproto',
  TELEGRAM_BOT_API: 'telegram_bot_api',
  TRADINGVIEW_WEBHOOK: 'tradingview_webhook',
  MT5_SOURCE_BRIDGE: 'mt5_source_bridge',
  CTRADER_SOURCE: 'ctrader_source',
  CUSTOM_SIGNED_API: 'custom_signed_api',
});

const DEFINITIONS = Object.freeze({
  [PROVIDER_TYPES.CLOUDFLARE_CONTAINER_MTPROTO]: Object.freeze({
    providerType: PROVIDER_TYPES.CLOUDFLARE_CONTAINER_MTPROTO,
    sourceFamily: SOURCE_FAMILIES.TELEGRAM,
    runtimeKind: 'cloudflare_container',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.CLOUDFLARE_DO_MTPROTO]: Object.freeze({
    providerType: PROVIDER_TYPES.CLOUDFLARE_DO_MTPROTO,
    sourceFamily: SOURCE_FAMILIES.TELEGRAM,
    runtimeKind: 'cloudflare_durable_object',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.EXTERNAL_MTPROTO]: Object.freeze({
    providerType: PROVIDER_TYPES.EXTERNAL_MTPROTO,
    sourceFamily: SOURCE_FAMILIES.TELEGRAM,
    runtimeKind: 'external',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.TELEGRAM_BOT_API]: Object.freeze({
    providerType: PROVIDER_TYPES.TELEGRAM_BOT_API,
    sourceFamily: SOURCE_FAMILIES.TELEGRAM,
    runtimeKind: 'webhook',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.TRADINGVIEW_WEBHOOK]: Object.freeze({
    providerType: PROVIDER_TYPES.TRADINGVIEW_WEBHOOK,
    sourceFamily: SOURCE_FAMILIES.TRADINGVIEW,
    runtimeKind: 'webhook',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.MT5_SOURCE_BRIDGE]: Object.freeze({
    providerType: PROVIDER_TYPES.MT5_SOURCE_BRIDGE,
    sourceFamily: SOURCE_FAMILIES.MT5,
    runtimeKind: 'bridge',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.CTRADER_SOURCE]: Object.freeze({
    providerType: PROVIDER_TYPES.CTRADER_SOURCE,
    sourceFamily: SOURCE_FAMILIES.CTRADER,
    runtimeKind: 'stream',
    nativeIdentity: true,
  }),
  [PROVIDER_TYPES.CUSTOM_SIGNED_API]: Object.freeze({
    providerType: PROVIDER_TYPES.CUSTOM_SIGNED_API,
    sourceFamily: SOURCE_FAMILIES.CUSTOM_API,
    runtimeKind: 'signed_api',
    nativeIdentity: false,
  }),
});

export function getProviderDefinition(providerType) {
  const definition = DEFINITIONS[String(providerType ?? '')];
  if (!definition) {
    throw new Error(`Unknown source provider: ${providerType ?? ''}`);
  }
  return definition;
}

export function normalizeProviderRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Source provider record is required');
  }

  const providerType = String(record.providerType ?? record.provider_type ?? '');
  const definition = getProviderDefinition(providerType);
  const sourceFamily = String(record.sourceFamily ?? record.source_family ?? definition.sourceFamily);

  if (sourceFamily !== definition.sourceFamily) {
    throw new Error(`Source family mismatch for provider ${providerType}`);
  }

  const priorityRaw = record.priority ?? 0;
  const priority = Number(priorityRaw);
  if (!Number.isFinite(priority)) {
    throw new Error('Source provider priority must be numeric');
  }

  return {
    id: record.id,
    workspaceId: record.workspaceId ?? record.workspace_id,
    providerType,
    sourceFamily,
    enabled: Boolean(record.enabled ?? record.is_active),
    isDefault: Boolean(record.isDefault ?? record.is_default),
    priority,
  };
}
