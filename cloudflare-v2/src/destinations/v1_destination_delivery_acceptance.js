import { runV1DestinationDeliveryStage } from './v1_destination_delivery_stage.js';
import { sendTelegramDestination } from './telegram_destination.js';

const READY_MADE_FORMAT_MODES = new Set(['none', 'clean', 'template', 'ai_then_fallback']);

function text(value) { return String(value ?? '').trim(); }

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function withDestinationFormattingMode(row = {}) {
  const settings = safeObject(row.settings);
  const requested = text(settings.formattingMode ?? settings.formatting_mode).toLowerCase();
  if (READY_MADE_FORMAT_MODES.has(requested)) {
    const template = { ...safeObject(row.template), formatting_mode: requested, formattingMode: requested };
    if (requested === 'none' || requested === 'clean') {
      template.parse_mode = 'plain';
      template.parseMode = 'plain';
    }
    return { ...row, template };
  }
  if (row.template) return row;
  return { ...row, template: { formatting_mode: 'none', parse_mode: 'plain' } };
}

function replyExternalEventId(event = {}) {
  const direct = text(event?.thread?.reply_to_event_id ?? event?.thread?.replyToEventId);
  if (direct) return direct;
  const replyMessageId = text(event?.thread?.reply_to_message_id ?? event?.thread?.replyToMessageId);
  const chatId = text(event?.metadata?.native_identity?.chat_id ?? event?.metadata?.nativeIdentity?.chatId);
  return replyMessageId && chatId ? `telegram:${chatId}:${replyMessageId}` : null;
}

async function findTradingEventId(supabase, workspaceId, externalEventId) {
  if (!supabase?.from || !workspaceId || !externalEventId) return null;
  const { data, error } = await supabase
    .from('trading_events')
    .select('id')
    .eq('workspace_id', String(workspaceId))
    .eq('external_event_id', String(externalEventId))
    .maybeSingle();
  if (error) throw new Error('TELEGRAM_THREAD_EVENT_LOOKUP_FAILED');
  return data?.id ? String(data.id) : null;
}

async function resolveReplyMessageId(supabase, workspaceId, destination, parentExternalEventId) {
  const eventId = await findTradingEventId(supabase, workspaceId, parentExternalEventId);
  if (!eventId) return null;
  const destinationKey = `telegram-destination:${destination.id}`;
  const { data, error } = await supabase
    .from('destination_deliveries')
    .select('response_payload')
    .eq('workspace_id', String(workspaceId))
    .eq('trading_event_id', eventId)
    .eq('destination_type', 'telegram')
    .eq('destination_ref', destinationKey)
    .eq('status', 'SUCCEEDED')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) throw new Error('TELEGRAM_THREAD_MAPPING_LOOKUP_FAILED');
  const value = data?.[0]?.response_payload?.messageId ?? data?.[0]?.response_payload?.message_id;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

async function recordMessageMapping(supabase, workspaceId, destination, externalEventId, messageId) {
  const eventId = await findTradingEventId(supabase, workspaceId, externalEventId);
  if (!eventId) throw new Error('TELEGRAM_THREAD_EVENT_LOOKUP_FAILED');
  const destinationKey = `telegram-destination:${destination.id}`;
  const idempotencyKey = `telegram:${destination.id}:${externalEventId}`;
  const row = {
    workspace_id: String(workspaceId),
    trading_event_id: eventId,
    destination_type: 'telegram',
    destination_ref: destinationKey,
    idempotency_key: idempotencyKey,
    status: 'SUCCEEDED',
    attempt_count: 1,
    response_payload: {
      messageId: Number(messageId),
      chatId: String(destination.destination_ref ?? destination.destinationRef ?? ''),
      destinationId: String(destination.id),
      sourceExternalEventId: String(externalEventId),
    },
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('destination_deliveries')
    .upsert(row, { onConflict: 'workspace_id,idempotency_key' });
  if (error) throw new Error('TELEGRAM_THREAD_MAPPING_WRITE_FAILED');
}

export async function runV1DestinationDeliveryAcceptanceStage(input = {}, deps = {}) {
  const baseStore = deps.destinationStore;
  const supabase = deps.supabase;
  const workspaceId = text(input.workspaceId);
  const routedByChatId = new Map();
  const parentExternalEventId = replyExternalEventId(input.event);
  const currentExternalEventId = text(input?.event?.external_event_id ?? input?.event?.externalEventId);

  const wrappedStore = baseStore ? {
    ...baseStore,
    async listRoutedDestinations(...args) {
      const rows = await baseStore.listRoutedDestinations(...args);
      return (rows || []).map((row) => {
        if (String(row?.destination_type ?? row?.destinationType ?? '').toLowerCase() !== 'telegram') return row;
        routedByChatId.set(text(row.destination_ref ?? row.destinationRef), row);
        return withDestinationFormattingMode(row);
      });
    },
  } : baseStore;

  const baseSendTelegram = deps.sendTelegram || sendTelegramDestination;
  const threadedSendTelegram = async (sendInput = {}) => {
    const destination = routedByChatId.get(text(sendInput.chatId));
    let replyToMessageId = null;
    if (parentExternalEventId && destination) {
      try {
        replyToMessageId = await resolveReplyMessageId(supabase, workspaceId, destination, parentExternalEventId);
      } catch {
        return { ok: false, status: 0, errorCode: 'TELEGRAM_REPLY_PARENT_LOOKUP_FAILED' };
      }
      if (!replyToMessageId) {
        return { ok: false, status: 0, errorCode: 'TELEGRAM_REPLY_PARENT_UNRESOLVED' };
      }
    }
    const result = await baseSendTelegram({ ...sendInput, ...(replyToMessageId ? { replyToMessageId } : {}) });
    if (result?.ok && destination && currentExternalEventId && result.messageId != null && supabase?.from) {
      try {
        await recordMessageMapping(supabase, workspaceId, destination, currentExternalEventId, result.messageId);
      } catch {
        // The Telegram message is already accepted by Telegram. Never convert a
        // mapping-journal failure into a send failure because a retry could create
        // a duplicate post. A future reply will fail closed if this mapping is absent.
        return { ...result, threadMappingPersisted: false };
      }
    }
    return { ...result, ...(result?.ok ? { threadMappingPersisted: true } : {}) };
  };

  return runV1DestinationDeliveryStage(input, {
    ...deps,
    destinationStore: wrappedStore,
    sendTelegram: threadedSendTelegram,
  });
}

export const telegramThreading = {
  replyExternalEventId,
  resolveReplyMessageId,
  recordMessageMapping,
};
