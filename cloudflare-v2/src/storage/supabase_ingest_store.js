import { decryptSecret } from '../security/secret_box.js';

function persistedInterpretation(row = {}) {
  const status = String(row.processing_status ?? '').trim();
  if (!status) return null;
  const interpretation = { status };
  if (row.canonical_intent && typeof row.canonical_intent === 'object') {
    interpretation.intent = row.canonical_intent;
  }
  if (row.error_code) interpretation.reason = String(row.error_code);
  return interpretation;
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
          .select('id,processing_status,canonical_intent,error_code')
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
          const interpretation = persistedInterpretation(existing);
          return {
            ok: true,
            duplicate: true,
            eventId: existing.id,
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
