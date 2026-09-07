import { decryptSecret } from '../security/secret_box.js';

export class SupabaseSourceStore {
  constructor(supabase, { masterKey } = {}) {
    if (!supabase?.from) throw new TypeError('supabase client is required');
    if (!masterKey) throw new TypeError('masterKey is required');
    this.supabase = supabase;
    this.masterKey = masterKey;
  }

  async getActiveSource(sourceInstanceId) {
    const { data, error } = await this.supabase
      .from('source_connections')
      .select('id,workspace_id,source_type,source_instance_id,secret_ciphertext,is_active,settings')
      .eq('source_instance_id', String(sourceInstanceId))
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new Error(`source lookup failed: ${error.message}`);
    if (!data) return null;
    return {
      ...data,
      secret: await decryptSecret(data.secret_ciphertext, this.masterKey),
      secret_ciphertext: undefined,
    };
  }
}

export class SupabaseEventStore {
  constructor(supabase) {
    if (!supabase?.from) throw new TypeError('supabase client is required');
    this.supabase = supabase;
  }

  async findExisting(row) {
    const { data, error } = await this.supabase
      .from('trading_events')
      .select('id')
      .eq('workspace_id', row.workspace_id)
      .eq('source_connection_id', row.source_connection_id)
      .eq('external_event_id', String(row.external_event_id))
      .maybeSingle();
    if (error) throw new Error(`event lookup failed: ${error.message}`);
    return data || null;
  }

  async reserve(row) {
    const { data, error } = await this.supabase
      .from('trading_events')
      .insert({ ...row, processing_status: 'RECEIVED' })
      .select('id');
    if (!error) return { ok: true, duplicate: false, eventId: data?.[0]?.id ?? null };
    if (String(error.code) !== '23505') return { ok: false, error: error.message };
    const existing = await this.findExisting(row);
    return { ok: true, duplicate: true, eventId: existing?.id ?? null };
  }

  async updateInterpretation(eventId, interpretation) {
    const status = interpretation?.status === 'READY' || interpretation?.status === 'MANAGEMENT'
      ? 'INTERPRETED'
      : 'NEEDS_REVIEW';
    const { error } = await this.supabase
      .from('trading_events')
      .update({
        processing_status: status,
        canonical_intent: interpretation,
        error_code: interpretation?.reason || null,
      })
      .eq('id', eventId);
    if (error) throw new Error(`event interpretation persistence failed: ${error.message}`);
  }
}
