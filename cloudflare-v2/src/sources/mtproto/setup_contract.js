function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function normalizedBaseUrl(workerBaseUrl) {
  const raw = text(workerBaseUrl) || 'https://trade.mkety.com';
  return raw.replace(/\/+$/g, '');
}

function hasTelegramCredential(credentials = {}, key) {
  return Boolean(text(credentials?.[key]));
}

function credentialConfigured(credentials = {}) {
  return {
    apiId: hasTelegramCredential(credentials, 'apiId'),
    apiHash: hasTelegramCredential(credentials, 'apiHash'),
    session: hasTelegramCredential(credentials, 'session'),
  };
}

function missingCredential(credentials = {}) {
  if (!hasTelegramCredential(credentials, 'apiId')) return 'MTPROTO_API_ID_REQUIRED';
  if (!hasTelegramCredential(credentials, 'apiHash')) return 'MTPROTO_API_HASH_REQUIRED';
  if (!hasTelegramCredential(credentials, 'session')) return 'MTPROTO_SESSION_REQUIRED';
  return null;
}

function envPlaceholder(name) {
  return '${' + String(name || 'INTERNAL_SOURCE_TRANSPORT_TOKEN') + '}';
}

export function createExternalVmMtprotoHandoff({
  sourceConnectionId,
  sourceExternalId,
  workerBaseUrl,
  internalSourceTokenName = 'INTERNAL_SOURCE_TRANSPORT_TOKEN',
} = {}) {
  const sourceId = text(sourceConnectionId);
  if (!sourceId) return { ok: false, reason: 'SOURCE_CONNECTION_REQUIRED' };
  const externalId = text(sourceExternalId) || '<telegram_chat_id_or_channel_id>';
  const url = `${normalizedBaseUrl(workerBaseUrl)}/api/v1/internal/source-event`;
  return {
    ok: true,
    providerType: 'external_mtproto',
    credentialsRequiredByMkety: [],
    handoff: {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mkety-Internal-Source-Token': envPlaceholder(internalSourceTokenName),
      },
      payloadExample: {
        source_id: sourceId,
        source_external_id: externalId,
        external_event_id: `telegram:${externalId}:<message_id>`,
        occurred_at: '<iso_timestamp>',
        text: 'BUY XAUUSD 2500\nSL 2490\nTP1 2510',
        metadata: {
          native_identity: {
            chat_id: externalId,
            message_id: '<message_id>',
          },
        },
      },
    },
  };
}

export function createMtprotoSetupPlan(input = {}) {
  const providerType = text(input.providerType ?? input.provider_type);
  const credentials = input.credentials && typeof input.credentials === 'object' ? input.credentials : {};
  const sourceConnectionId = text(input.sourceConnectionId ?? input.source_connection_id);
  const sourceExternalId = text(input.sourceExternalId ?? input.source_external_id);
  const workerBaseUrl = input.workerBaseUrl ?? input.worker_base_url;

  if (!providerType) return { ok: false, reason: 'MTPROTO_PROVIDER_REQUIRED' };

  if (providerType === 'external_mtproto') {
    if (hasTelegramCredential(credentials, 'apiId') || hasTelegramCredential(credentials, 'apiHash') || hasTelegramCredential(credentials, 'session')) {
      return { ok: false, reason: 'EXTERNAL_MTPROTO_DOES_NOT_COLLECT_TELEGRAM_CREDENTIALS' };
    }
    return createExternalVmMtprotoHandoff({
      sourceConnectionId,
      sourceExternalId,
      workerBaseUrl,
      internalSourceTokenName: input.internalSourceTokenName ?? input.internal_source_token_name,
    });
  }

  if (providerType === 'cloudflare_container_mtproto' || providerType === 'cloudflare_do_mtproto') {
    if (!sourceConnectionId) return { ok: false, reason: 'SOURCE_CONNECTION_REQUIRED' };
    const missing = missingCredential(credentials);
    if (missing) return { ok: false, reason: missing };
    const mode = providerType === 'cloudflare_container_mtproto' ? 'cloudflare_container' : 'cloudflare_do';
    return {
      ok: true,
      providerType,
      sourceConnectionId,
      credentialsRequiredByMkety: ['apiId', 'apiHash', 'session'],
      credentialsConfigured: credentialConfigured(credentials),
      runtime: {
        mode,
        recoveryCron: '* * * * *',
        workerQueue: 'SOURCE_EVENT_QUEUE',
        secretsAreEncrypted: true,
      },
      publicInstructions: [
        'Mkety hosts this MTProto listener.',
        'Telegram credentials are encrypted server-side and never returned to the browser.',
        'Use a test Telegram account/channel before production channels.',
      ],
    };
  }

  return { ok: false, reason: 'MTPROTO_PROVIDER_UNSUPPORTED' };
}
