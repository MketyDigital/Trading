import { decryptSecret } from '../security/secret_box.js';

const TERMINAL_INTERPRETATION_STATUSES = new Set([
  'READY',
  'MANAGEMENT',
  'NO_ACTION',
  'NEEDS_REVIEW',
]);

function persistedInterpretation(row = {}) {
  const status = String(row.processing_status ?? '').trim();
  if (!TERMINAL_INTERPRETATION_STATUSES.has(status)) return null;
  const interpretation = { status };
  if (row.canonical_intent && typeof row.canonical_intent === 'object') {
    interpretation.intent = row.canonical_intent;
  }
  if (row.error_code) interpretation.reason = String(row.error_code);
  return interpretation;
}

function persistedEvent(row = {}) {
  if (!row?.external_event_id) return null;
  return {
    version: String(row.event_version || '1.0'),
    source_type: row.source_type == null ? null : String(row.source_type),
    source_external_id: row.source_external_id == null ? null : String(row.source_external_id),
    external_event_id: String(row.external_event_id),
    occurred_at: row.occurred_at || row.created_at || null,
    received_at: row.created_at || row.occurred_at || null,
    text: String(row.raw_text ?? ''),
    structured_payload: row.structured_payload && typeof row.structured_payload === 'object'
      ? row.structured_payload
      : {},
    thread: row.thread && typeof row.thread === 'object' ? row.thread : {},
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sourceAcceptsChat(row = {}, chatId, externalIdentity = null) {
  const config = row.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {};
  const mode = clean(config.chat_acceptance_mode || 'allowlist').toLowerCase();
  const allowed = Array.isArray(config.allowed_chat_ids) ? config.allowed_chat_ids.map(clean).filter(Boolean) : [];
  if (externalIdentity && clean(row.external_identity) && clean(row.external_identity) !== clean(externalIdentity)) return false;
  if (mode === 'all_visible') return true;
  if (mode !== 'allowlist') return false;
  return allowed.includes(clean(chatId));
}

function sourceShape(data, secret) {
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    source_type: data.source_type,
    source_instance_id: data.source_instance_id,
    source_family: data.source_family ?? null,
    provider_type: data.provider_type ?? null,
    external_identity: data.external_identity ?? null,
    config: data.config || {},
    settings: data.settings || {},
    secret,
  };
}

export function createSupabaseIngestStores(supabase, {
  masterKey,
  decryptFn = decryptSecret,
} = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  if (!masterKey) throw new TypeError('Trading master key is required');

  const sourceStore = {
    async getActiveSource(sourceId) {
      if (!sourceId) return null;
      const { data, error } = await supabase
        .from('source_connections')
        .select('id,workspace_id,source_type,source_instance_id,source_family,provider_type,external_identity,config,secret_ciphertext,settings,is_active')
        .eq('id', String(sourceId))
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data?.id || !data.secret_ciphertext) return null;
      const secret = await decryptFn(data.secret_ciphertext, masterKey);
      return sourceShape(data, secret);
    },

    async findActiveExternalMtprotoSourcesForChat(chatId, { externalIdentity = null } = {}) {
      const normalizedChatId = clean(chatId);
      if (!normalizedChatId) return [];
      const { data, error } = await supabase
        .from('source_connections')
        .select('id,workspace_id,source_type,source_instance_id,source_family,provider_type,external_identity,config,secret_ciphertext,settings,is_active')
        .eq('provider_type', 'external_mtproto')
        .eq('is_active', true);
      if (error) throw new Error('EXTERNAL_MTPROTO_SOURCE_LOOKUP_FAILED');
      if (!Array.isArray(data)) throw new Error('EXTERNAL_MTPROTO_SOURCE_LOOKUP_FAILED');

      const matching = data.filter((row) => row?.id && row.secret_ciphertext && sourceAcceptsChat(row, normalizedChatId, externalIdentity));
      const result = [];
      for (const row of matching) {
        const secret = await decryptFn(row.secret_ciphertext, masterKey);
        result.push(sourceShape(row, secret));
      }
      return result;
    },
  };

  const eventStore = {
    async reserve(row) {
      const { data, error } = await supabase
        .from('trading_events')
        .insert(row)
        .select('id')
        .single();

      if (!error && data?.id) {
        return { ok: true, duplicate: false, eventId: data.id };
      }

      if (error?.code === '23505') {
        let lookup = supabase
          .from('trading_events')
          .select('id,event_version,source_type,source_external_id,external_event_id,occurred_at,created_at,raw_text,structured_payload,thread,metadata,processing_status,canonical_intent,error_code')
          .eq('workspace_id', row.workspace_id);

        if (row.canonical_event_id) {
          lookup = lookup.eq('canonical_event_id', row.canonical_event_id);
        } else {
          lookup = lookup
            .eq('source_connection_id', row.source_connection_id)
            .eq('external_event_id', row.external_event_id);
        }

        const { data: existing, error: lookupError } = await lookup.maybeSingle();
        if (!lookupError && existing?.id) {
          const event = persistedEvent(existing);
          const interpretation = persistedInterpretation(existing);
          return {
            ok: true,
            duplicate: true,
            eventId: existing.id,
            ...(event ? { event } : {}),
            ...(interpretation ? { interpretation } : {}),
          };
        }
      }

      return { ok: false, duplicate: false, error: error?.message || 'event reservation failed' };
    },

    async updateInterpretation(eventId, interpretation = {}) {
      if (!eventId) return;
      const status = String(interpretation.status || 'NEEDS_REVIEW');
      const payload = {
        processing_status: status,
        canonical_intent: interpretation.intent || null,
        error_code: status === 'READY' || status === 'MANAGEMENT' ? null : interpretation.reason || null,
      };
      await supabase.from('trading_events').update(payload).eq('id', eventId);
    },
  };

  return { sourceStore, eventStore };
}
