import {
  PROVIDER_TYPES,
  getProviderDefinition,
} from './provider_registry.js';

function failure(reason, sourceId = null) {
  return {
    ok: false,
    reason,
    sourceId: sourceId === undefined || sourceId === null ? null : String(sourceId),
  };
}

function plainConfig(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return { ...value };
}

function normalizedStringList(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean))];
}

function validateContainerConfig(config) {
  const chatIds = normalizedStringList(config.chat_ids);
  if (!chatIds || chatIds.length === 0) {
    return failure('MTPROTO_CHAT_IDS_NOT_CONFIGURED');
  }
  return {
    ok: true,
    config: {
      ...config,
      chat_ids: chatIds,
    },
  };
}

function validateExternalMtprotoConfig(config) {
  const mode = String(config.chat_acceptance_mode ?? 'allowlist').trim();
  if (mode !== 'allowlist' && mode !== 'all_visible') {
    return failure('MTPROTO_SOURCE_POLICY_INVALID');
  }

  let allowedChatIds = [];
  if (config.allowed_chat_ids !== undefined) {
    allowedChatIds = normalizedStringList(config.allowed_chat_ids);
    if (!allowedChatIds) return failure('MTPROTO_SOURCE_POLICY_INVALID');
  }

  return {
    ok: true,
    config: {
      ...config,
      chat_acceptance_mode: mode,
      allowed_chat_ids: allowedChatIds,
    },
  };
}

function validateProviderSpecificConfig(providerType, config) {
  switch (providerType) {
    case PROVIDER_TYPES.CLOUDFLARE_CONTAINER_MTPROTO:
      return validateContainerConfig(config);
    case PROVIDER_TYPES.EXTERNAL_MTPROTO:
      return validateExternalMtprotoConfig(config);
    default:
      return { ok: true, config };
  }
}

export function validateProviderConfiguration(record) {
  const sourceId = record?.id ?? null;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return failure('SOURCE_PROVIDER_CONFIG_INVALID', sourceId);
  }

  const providerType = String(record.providerType ?? record.provider_type ?? '').trim();
  const sourceFamily = String(record.sourceFamily ?? record.source_family ?? '').trim();

  let definition;
  try {
    definition = getProviderDefinition(providerType);
  } catch {
    return failure('SOURCE_PROVIDER_UNKNOWN', sourceId);
  }

  if (sourceFamily !== definition.sourceFamily) {
    return failure('SOURCE_PROVIDER_FAMILY_MISMATCH', sourceId);
  }

  const externalIdentity = String(
    record.externalIdentity ?? record.external_identity ?? '',
  ).trim();
  if (!externalIdentity) {
    return failure('SOURCE_EXTERNAL_IDENTITY_REQUIRED', sourceId);
  }

  const config = plainConfig(record.config);
  if (!config) return failure('SOURCE_PROVIDER_CONFIG_INVALID', sourceId);

  const providerConfig = validateProviderSpecificConfig(providerType, config);
  if (!providerConfig.ok) return failure(providerConfig.reason, sourceId);

  const priority = Number(record.priority ?? 0);
  if (!Number.isFinite(priority)) {
    return failure('SOURCE_PROVIDER_PRIORITY_INVALID', sourceId);
  }

  return {
    ok: true,
    source: {
      id: record.id,
      workspaceId: record.workspaceId ?? record.workspace_id,
      providerType,
      sourceFamily,
      enabled: Boolean(record.enabled ?? record.is_active),
      isDefault: Boolean(record.isDefault ?? record.is_default),
      priority,
      externalIdentity,
      config: providerConfig.config,
    },
  };
}
