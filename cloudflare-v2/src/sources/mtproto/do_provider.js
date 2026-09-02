function required(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function positiveInteger(value, code) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(code);
  return number;
}

function occurredAt(value, nowMs) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(nowMs).toISOString();
}

function messageHandler(client, handler) {
  if (client?.onNewMessage?.add) {
    client.onNewMessage.add(handler);
    return;
  }
  if (typeof client?.on === 'function') {
    client.on('new_message', handler);
    return;
  }
  throw new Error('MTPROTO_DO_UPDATES_UNSUPPORTED');
}

function storageAdapter(storage) {
  return {
    async get(key) { return storage.get(`mtcute_${String(key)}`); },
    async set(key, value) { await storage.put(`mtcute_${String(key)}`, value); },
    async delete(key) { await storage.delete(`mtcute_${String(key)}`); },
  };
}

export function createMtprotoDoProvider({
  state,
  clientFactory,
  enqueueSourceEvent,
  now = Date.now,
  reconnectDelayMs = 30_000,
} = {}) {
  if (!state?.storage?.get || !state?.storage?.put) throw new TypeError('Durable Object state storage is required');
  if (typeof clientFactory !== 'function') throw new TypeError('MTProto client factory is required');
  if (typeof enqueueSourceEvent !== 'function') throw new TypeError('source event enqueue function is required');

  const delay = Math.max(1_000, Number(reconnectDelayMs) || 30_000);
  let client = null;
  let lastErrorCode = null;

  async function readIdentity() {
    return {
      sourceId: await state.storage.get('source_id') ?? null,
      workspaceId: await state.storage.get('workspace_id') ?? null,
      accountScope: await state.storage.get('account_scope') ?? null,
    };
  }

  async function scheduleReconnect() {
    if (state.storage.setAlarm) await state.storage.setAlarm(Number(now()) + delay);
  }

  async function createAndConnect({ apiId, apiHash, sessionString } = {}) {
    const mtcuteStorage = storageAdapter(state.storage);
    const nextClient = clientFactory({
      apiId,
      apiHash,
      storage: mtcuteStorage,
      updates: { catchUp: true },
      testMode: false,
    });

    if (!nextClient) throw new Error('MTPROTO_DO_CLIENT_NOT_CREATED');
    if (sessionString && typeof nextClient.importSession === 'function') {
      await nextClient.importSession(sessionString);
    }

    messageHandler(nextClient, handleIncomingMessage);
    await nextClient.connect();
    client = nextClient;
    lastErrorCode = null;
    return nextClient;
  }

  async function persistedBootstrap() {
    const apiId = positiveInteger(await state.storage.get('api_id'), 'MTPROTO_DO_API_ID_NOT_CONFIGURED');
    const apiHash = required(await state.storage.get('api_hash'), 'MTPROTO_DO_API_HASH_NOT_CONFIGURED');
    const sessionString = await state.storage.get('session_string') ?? null;
    return { apiId, apiHash, sessionString };
  }

  async function start({ sourceId, workspaceId, accountScope, apiId, apiHash, sessionString } = {}) {
    const identity = {
      sourceId: required(sourceId, 'MTPROTO_DO_SOURCE_REQUIRED'),
      workspaceId: required(workspaceId, 'MTPROTO_DO_WORKSPACE_REQUIRED'),
      accountScope: required(accountScope, 'MTPROTO_DO_ACCOUNT_SCOPE_REQUIRED'),
    };
    const trustedApiId = positiveInteger(apiId, 'MTPROTO_DO_API_ID_REQUIRED');
    const trustedApiHash = required(apiHash, 'MTPROTO_DO_API_HASH_REQUIRED');

    await state.storage.put('source_id', identity.sourceId);
    await state.storage.put('workspace_id', identity.workspaceId);
    await state.storage.put('account_scope', identity.accountScope);
    await state.storage.put('api_id', trustedApiId);
    await state.storage.put('api_hash', trustedApiHash);
    await state.storage.put('is_active', true);
    if (sessionString != null) await state.storage.put('session_string', String(sessionString));

    try {
      await createAndConnect({
        apiId: trustedApiId,
        apiHash: trustedApiHash,
        sessionString: sessionString ?? await state.storage.get('session_string') ?? null,
      });
    } catch (error) {
      lastErrorCode = 'MTPROTO_DO_CONNECT_FAILED';
      await scheduleReconnect();
      throw error;
    }

    await scheduleReconnect();
    return status();
  }

  async function authenticate({ phone, code } = {}) {
    const trustedPhone = required(phone, 'MTPROTO_DO_PHONE_REQUIRED');
    const trustedCode = required(code, 'MTPROTO_DO_CODE_REQUIRED');
    if (!client || typeof client.signIn !== 'function') throw new Error('MTPROTO_DO_CLIENT_NOT_RUNNING');

    try {
      await client.signIn({ phone: trustedPhone, code: trustedCode });
      if (typeof client.exportSession !== 'function') throw new Error('MTPROTO_DO_SESSION_EXPORT_UNSUPPORTED');
      const sessionString = required(await client.exportSession(), 'MTPROTO_DO_SESSION_EXPORT_FAILED');
      await state.storage.put('session_string', sessionString);
      lastErrorCode = null;
      return { authenticated: true };
    } catch (error) {
      lastErrorCode = 'MTPROTO_DO_AUTH_FAILED';
      throw error;
    }
  }

  async function stop() {
    await state.storage.put('is_active', false);
    if (client?.close) await client.close();
    client = null;
    lastErrorCode = null;
    return status();
  }

  async function status() {
    const active = Boolean(await state.storage.get('is_active'));
    const identity = await readIdentity();
    const connected = active && Boolean(client?.isConnected?.());
    return {
      providerType: 'cloudflare_do_mtproto',
      sourceId: identity.sourceId,
      workspaceId: identity.workspaceId,
      accountScope: identity.accountScope,
      active,
      connected,
      status: !active ? 'DISABLED' : connected ? 'HEALTHY' : 'DEGRADED',
      lastErrorCode,
    };
  }

  async function alarm() {
    const active = Boolean(await state.storage.get('is_active'));
    if (!active) return status();

    if (!client?.isConnected?.()) {
      try {
        if (client?.close) await client.close();
      } catch {
        // Reconnect continues with a fresh client; close failure is local only.
      }
      client = null;
      try {
        await createAndConnect(await persistedBootstrap());
      } catch (error) {
        lastErrorCode = 'MTPROTO_DO_RECONNECT_FAILED';
        await scheduleReconnect();
        throw error;
      }
    }

    await scheduleReconnect();
    return status();
  }

  async function handleIncomingMessage(message = {}) {
    if (message.isOutgoing) return { ignored: true };

    const identity = await readIdentity();
    if (!identity.sourceId || !identity.accountScope) throw new Error('MTPROTO_DO_SOURCE_IDENTITY_MISSING');

    const chatId = required(message?.chat?.id ?? message.chatId ?? message.chat_id, 'MTPROTO_DO_CHAT_ID_MISSING');
    const messageId = required(message.id ?? message.messageId ?? message.message_id, 'MTPROTO_DO_MESSAGE_ID_MISSING');
    const replyId = message.replyToMessageId ?? message.reply_to_message_id ?? message.replyTo?.messageId ?? null;
    const threadId = message.threadId ?? message.thread_id ?? null;

    const event = {
      source_external_id: identity.accountScope,
      external_event_id: `telegram:${chatId}:${messageId}`,
      occurred_at: occurredAt(message.date ?? message.timestamp, Number(now())),
      text: String(message.text ?? message.caption ?? ''),
      structured_payload: {},
      thread: {
        thread_id: threadId == null ? null : String(threadId),
        reply_to_event_id: replyId == null ? null : String(replyId),
        edited_event_id: null,
      },
      metadata: {
        native_identity: { chat_id: String(chatId), message_id: String(messageId) },
        account_scope: identity.accountScope,
        media: Boolean(message.media),
      },
    };

    await enqueueSourceEvent({ id: identity.sourceId }, event);
    return { queued: true, externalEventId: event.external_event_id };
  }

  return { start, authenticate, stop, status, alarm, handleIncomingMessage };
}
