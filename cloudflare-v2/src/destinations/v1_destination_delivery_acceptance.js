import { runV1DestinationDeliveryStage } from './v1_destination_delivery_stage.js';
import { sendTelegramDestination, editTelegramDestination } from './telegram_destination.js';

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

function destinationFormattingMode(destination = {}) {
  const settings = safeObject(destination.settings);
  const requested = text(settings.formattingMode ?? settings.formatting_mode).toLowerCase();
  return READY_MADE_FORMAT_MODES.has(requested) ? requested : 'none';
}

function replyExternalEventId(event = {}) {
  const direct = text(event?.thread?.reply_to_event_id ?? event?.thread?.replyToEventId);
  if (direct) return direct;
  const replyMessageId = text(event?.thread?.reply_to_message_id ?? event?.thread?.replyToMessageId);
  const chatId = text(event?.metadata?.native_identity?.chat_id ?? event?.metadata?.nativeIdentity?.chatId);
  return replyMessageId && chatId ? `telegram:${chatId}:${replyMessageId}` : null;
}

function editedExternalEventId(event = {}) {
  const direct = text(event?.thread?.edited_event_id ?? event?.thread?.editedEventId);
  const chatId = text(event?.metadata?.native_identity?.chat_id ?? event?.metadata?.nativeIdentity?.chatId);
  if (direct) {
    if (direct.startsWith('telegram:')) return direct;
    if (chatId && /^-?\d+$/.test(direct)) return `telegram:${chatId}:${direct}`;
    return direct;
  }
  const kind = text(event?.metadata?.telegram_update_kind ?? event?.metadata?.telegramUpdateKind).toLowerCase();
  if (kind !== 'edited_message' && kind !== 'edited_channel_post') return null;
  const current = text(event?.external_event_id ?? event?.externalEventId);
  return current || null;
}

function equivalentTelegramExternalEventIds(externalEventId) {
  const direct = text(externalEventId);
  if (!direct) return [];
  const values = [direct];
  if (direct.startsWith('telegram:')) {
    const native = direct.slice('telegram:'.length);
    if (/^-?\d+:\d+$/.test(native)) values.push(native);
  } else if (/^-?\d+:\d+$/.test(direct)) {
    values.push(`telegram:${direct}`);
  }
  return [...new Set(values)];
}

async function findTradingEventId(supabase, workspaceId, externalEventId) {
  if (!supabase?.from || !workspaceId || !externalEventId) return null;
  for (const candidate of equivalentTelegramExternalEventIds(externalEventId)) {
    const { data, error } = await supabase
      .from('trading_events')
      .select('id')
      .eq('workspace_id', String(workspaceId))
      .eq('external_event_id', candidate)
      .maybeSingle();
    if (error) throw new Error('TELEGRAM_THREAD_EVENT_LOOKUP_FAILED');
    if (data?.id) return String(data.id);
  }
  return null;
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

async function recordTelegramDeliveryOutcome(supabase, workspaceId, destination, externalEventId, result = {}) {
  const eventId = await findTradingEventId(supabase, workspaceId, externalEventId);
  if (!eventId) throw new Error('TELEGRAM_THREAD_EVENT_LOOKUP_FAILED');
  const destinationKey = `telegram-destination:${destination.id}`;
  const idempotencyKey = `telegram:${destination.id}:${externalEventId}`;
  const succeeded = result?.ok === true && result?.messageId != null;
  const responsePayload = {
    chatId: String(destination.destination_ref ?? destination.destinationRef ?? ''),
    destinationId: String(destination.id),
    sourceExternalEventId: String(externalEventId),
    httpStatus: Number(result?.status || 0),
    ...(result?.messageId != null ? { messageId: Number(result.messageId) } : {}),
    ...(result?.edited === true ? { edited: true } : {}),
    ...(result?.providerCode != null ? { providerCode: result.providerCode } : {}),
    ...(text(result?.providerDescription) ? { providerDescription: text(result.providerDescription).slice(0, 300) } : {}),
    ...(result?.retryAfter != null ? { retryAfter: Number(result.retryAfter) } : {}),
    ...(result?.replyParentFallback === true ? { replyParentFallback: true } : {}),
  };
  const row = {
    workspace_id: String(workspaceId),
    trading_event_id: eventId,
    destination_type: 'telegram',
    destination_ref: destinationKey,
    idempotency_key: idempotencyKey,
    status: succeeded ? 'SUCCEEDED' : 'FAILED',
    error_code: succeeded ? null : (text(result?.errorCode) || 'TELEGRAM_DELIVERY_FAILED'),
    failure_class: succeeded ? null : (Number(result?.status) === 429 || Number(result?.status) >= 500 ? 'RETRYABLE' : 'TERMINAL'),
    attempt_count: 1,
    response_payload: responsePayload,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('destination_deliveries')
    .upsert(row, { onConflict: 'workspace_id,idempotency_key' });
  if (error) throw new Error('TELEGRAM_DELIVERY_JOURNAL_WRITE_FAILED');
}

async function recordMessageMapping(supabase, workspaceId, destination, externalEventId, messageId) {
  return recordTelegramDeliveryOutcome(supabase, workspaceId, destination, externalEventId, {
    ok: true,
    status: 200,
    messageId,
  });
}

export async function runV1DestinationDeliveryAcceptanceStage(input = {}, deps = {}) {
  const baseStore = deps.destinationStore;
  const supabase = deps.supabase;
  const workspaceId = text(input.workspaceId);
  const routedByChatId = new Map();
  const parentExternalEventId = replyExternalEventId(input.event);
  const sourceEditedExternalEventId = editedExternalEventId(input.event);
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
  const baseEditTelegram = deps.editTelegram || editTelegramDestination;
  const threadedSendTelegram = async (sendInput = {}) => {
    const destination = routedByChatId.get(text(sendInput.chatId));
    let result;
    let replyToMessageId = null;
    let replyParentFallback = false;

    if (sourceEditedExternalEventId && destination) {
      let mappedMessageId = null;
      try {
        mappedMessageId = await resolveReplyMessageId(supabase, workspaceId, destination, sourceEditedExternalEventId);
      } catch {
        result = { ok: false, status: 0, errorCode: 'TELEGRAM_EDIT_PARENT_LOOKUP_FAILED' };
      }
      if (!result && !mappedMessageId) {
        result = { ok: false, status: 0, errorCode: 'TELEGRAM_EDIT_PARENT_UNRESOLVED' };
      }
      if (!result) {
        result = await baseEditTelegram({ ...sendInput, messageId: mappedMessageId });
      }
    } else {
      if (parentExternalEventId && destination) {
        try {
          replyToMessageId = await resolveReplyMessageId(supabase, workspaceId, destination, parentExternalEventId);
        } catch {
          result = { ok: false, status: 0, errorCode: 'TELEGRAM_REPLY_PARENT_LOOKUP_FAILED' };
        }
        if (!result && !replyToMessageId) {
          // A reply is a distinct source event. If its mapped parent is absent,
          // preserve delivery as a standalone message rather than dropping it.
          // The destination/event idempotency key still guarantees one send.
          replyParentFallback = true;
        }
      }
      if (!result) {
        result = await baseSendTelegram({ ...sendInput, ...(replyToMessageId ? { replyToMessageId } : {}) });
        if (replyParentFallback && result && typeof result === 'object') {
          result = { ...result, replyParentFallback: true };
        }
      }
    }

    if (destination && currentExternalEventId && supabase?.from) {
      try {
        await recordTelegramDeliveryOutcome(supabase, workspaceId, destination, currentExternalEventId, result);
      } catch {
        return {
          ...result,
          deliveryJournalPersisted: false,
          ...(result?.ok ? { threadMappingPersisted: false } : {}),
        };
      }
    }
    return {
      ...result,
      deliveryJournalPersisted: true,
      ...(result?.ok ? { threadMappingPersisted: true } : {}),
    };
  };

  return runV1DestinationDeliveryStage(input, {
    ...deps,
    destinationStore: wrappedStore,
    sendTelegram: threadedSendTelegram,
  });
}

export const telegramThreading = {
  replyExternalEventId,
  editedExternalEventId,
  resolveReplyMessageId,
  recordMessageMapping,
  recordTelegramDeliveryOutcome,
};
