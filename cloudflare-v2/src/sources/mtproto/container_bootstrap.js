import { decryptSecret } from '../../security/secret_box.js';

function required(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function parseProviderSecret(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw ?? ''));
  } catch {
    throw new Error('MTPROTO_PROVIDER_SECRET_INVALID');
  }

  const apiId = Number(parsed?.api_id);
  const apiHash = String(parsed?.api_hash ?? '').trim();
  const sessionString = String(parsed?.session_string ?? '').trim();
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !sessionString) {
    throw new Error('MTPROTO_PROVIDER_SECRET_INVALID');
  }

  return { apiId, apiHash, sessionString };
}

function normalizeChatIds(config) {
  const raw = Array.isArray(config?.chat_ids) ? config.chat_ids : [];
  const chatIds = [...new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean))];
  if (chatIds.length === 0) throw new Error('MTPROTO_CHAT_IDS_NOT_CONFIGURED');
  return chatIds;
}

export async function resolveMtprotoContainerBootstrap({
  supabase,
  workspaceId,
  sourceId,
  masterKey,
  internalSourceUrl,
  internalSourceToken,
  decryptFn = decryptSecret,
} = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  const trustedWorkspaceId = required(workspaceId, 'MTPROTO_WORKSPACE_REQUIRED');
  const trustedSourceId = required(sourceId, 'MTPROTO_SOURCE_REQUIRED');
  const trustedMasterKey = required(masterKey, 'TRADING_MASTER_KEY_NOT_CONFIGURED');
  const trustedInternalUrl = required(internalSourceUrl, 'MTPROTO_INTERNAL_SOURCE_URL_NOT_CONFIGURED');
  const trustedInternalToken = required(internalSourceToken, 'INTERNAL_SOURCE_TRANSPORT_TOKEN_NOT_CONFIGURED');

  const { data, error } = await supabase
    .from('source_connections')
    .select('id,workspace_id,source_family,provider_type,external_identity,is_active,config,provider_secret_ciphertext')
    .eq('workspace_id', trustedWorkspaceId)
    .eq('id', trustedSourceId)
    .eq('source_family', 'telegram')
    .eq('provider_type', 'cloudflare_container_mtproto')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data?.id) throw new Error('MTPROTO_SOURCE_NOT_AVAILABLE');
  if (!data.provider_secret_ciphertext) throw new Error('MTPROTO_PROVIDER_SECRET_NOT_CONFIGURED');

  const decrypted = await decryptFn(data.provider_secret_ciphertext, trustedMasterKey);
  const credentials = parseProviderSecret(decrypted);
  const accountScope = required(data.external_identity, 'MTPROTO_EXTERNAL_IDENTITY_NOT_CONFIGURED');
  const chatIds = normalizeChatIds(data.config || {});

  return {
    identity: {
      sourceId: String(data.id),
      workspaceId: String(data.workspace_id),
      accountScope,
    },
    bootstrap: {
      ...credentials,
      chatIds,
      internalSourceUrl: trustedInternalUrl,
      internalSourceToken: trustedInternalToken,
    },
  };
}
