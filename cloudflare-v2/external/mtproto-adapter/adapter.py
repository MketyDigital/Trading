import asyncio
from contextlib import suppress

from health import build_health, utc_now_iso
from v1_sink import PermanentV1DeliveryError, RetryableV1DeliveryError


def _default_client_factory(*, api_id, api_hash, session_string):
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    return TelegramClient(
        StringSession(session_string or ''),
        int(api_id),
        str(api_hash),
        auto_reconnect=True,
        connection_retries=None,
        retry_delay=1,
    )


def _telegram_event_id(chat_id, message_id):
    if message_id is None or str(message_id) == '':
        return None
    return f'telegram:{chat_id}:{message_id}'


def _topic_id(event):
    reply_header = getattr(event, 'reply_to', None)
    if reply_header is None:
        reply_header = getattr(getattr(event, 'message', None), 'reply_to', None)
    if reply_header is None or not getattr(reply_header, 'forum_topic', False):
        return None
    value = getattr(reply_header, 'reply_to_top_id', None)
    if value is None:
        value = getattr(reply_header, 'reply_to_msg_id', None)
    return None if value is None else str(value)


def _thread_contract(event, chat_id, message_id):
    reply_to_message_id = getattr(event, 'reply_to_msg_id', None)
    if reply_to_message_id is None:
        reply_to_message_id = getattr(getattr(event, 'message', None), 'reply_to_msg_id', None)
    topic_id = _topic_id(event)
    edited = getattr(event, 'edit_date', None) is not None or getattr(
        getattr(event, 'message', None), 'edit_date', None
    ) is not None
    return {
        'thread_id': None if topic_id is None else f'telegram:{chat_id}:topic:{topic_id}',
        'reply_to_event_id': _telegram_event_id(chat_id, reply_to_message_id),
        'edited_event_id': _telegram_event_id(chat_id, message_id) if edited else None,
    }


def build_telegram_event(event, *, account_scope=None, now_iso=None):
    chat_id = str(getattr(event, 'chat_id', '') or '')
    message_id = str(getattr(event, 'id', '') or '')
    if not chat_id or not message_id:
        return None

    clock = now_iso or utc_now_iso
    metadata = {
        'native_identity': {
            'chat_id': chat_id,
            'message_id': message_id,
        },
        'media': getattr(getattr(event, 'message', None), 'media', None) is not None,
    }
    if account_scope is not None and str(account_scope).strip():
        metadata['account_scope'] = str(account_scope).strip()

    return {
        'external_event_id': f'telegram:{chat_id}:{message_id}',
        'occurred_at': clock(),
        'text': str(getattr(event, 'raw_text', '') or ''),
        'thread': _thread_contract(event, chat_id, message_id),
        'metadata': metadata,
    }


class ExternalMtprotoAdapter:
    """Portable, source-local Telegram MTProto -> signed V1 transport adapter.

    The adapter owns no workspace authority or trading logic. Its only mutable
    state is instance-local connection, queue, retry and health state.
    """

    def __init__(
        self,
        *,
        api_id,
        api_hash,
        session_string,
        source_id,
        sink,
        account_scope=None,
        allowed_chat_ids=None,
        client_factory=None,
        queue_size=256,
        retry_delays=None,
        sleep=None,
        now_iso=None,
    ):
        if not source_id:
            raise ValueError('source_id is required')
        if sink is None:
            raise ValueError('sink is required')

        self.api_id = int(api_id)
        self.api_hash = str(api_hash)
        self.session_string = str(session_string or '')
        self.source_id = str(source_id)
        self.account_scope = None if account_scope is None else str(account_scope).strip() or None
        self.allowed_chat_ids = {str(value).strip() for value in (allowed_chat_ids or set()) if str(value).strip()}
        self.client_factory = client_factory or _default_client_factory
        self.sink = sink
        self.queue = asyncio.Queue(maxsize=max(1, int(queue_size)))
        self.retry_delays = tuple(
            max(0, float(delay)) for delay in (
                retry_delays if retry_delays is not None else (0.25, 1.0, 2.0)
            )
        )
        self.sleep = sleep or asyncio.sleep
        self.now_iso = now_iso or utc_now_iso

        self.client = None
        self._worker_task = None
        self._running = False
        self._connected = False
        self._status = 'IDLE'
        self._last_event_at = None
        self._last_message_id = None
        self._delivery_failures = 0
        self._delivery_successes = 0
        self._permanent_rejections = 0
        self._queue_overflows = 0
        self._last_delivery_error_at = None
        self._last_delivery_at = None
        self._reconnect_count = 0

    async def start(self):
        if self._running:
            return self.health()

        self._status = 'STARTING'
        self.client = self.client_factory(
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_string=self.session_string,
        )
        self.client.add_event_handler(self.handle_new_message)

        try:
            await self.client.connect()
            if not await self.client.is_user_authorized():
                self._status = 'ERROR'
                self._connected = False
                await self.client.disconnect()
                raise RuntimeError('Telegram MTProto session is not authorized')

            self._connected = True
            self._running = True
            self._worker_task = asyncio.create_task(self._delivery_worker())
            await self.client.catch_up()
            self._status = 'HEALTHY'
            return self.health()
        except BaseException:
            self._connected = False
            self._running = False
            if self._status != 'ERROR':
                self._status = 'ERROR'
            if self._worker_task:
                self._worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await self._worker_task
                self._worker_task = None
            raise

    async def stop(self, *, drain=True):
        self._running = False
        self._connected = False
        if self._worker_task:
            if drain:
                await self.queue.join()
            self._worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._worker_task
            self._worker_task = None
        if self.client is not None:
            await self.client.disconnect()
        self._status = 'STOPPED'
        return self.health()

    async def handle_new_message(self, event):
        if getattr(event, 'out', False):
            return False

        chat_id = str(getattr(event, 'chat_id', '') or '')
        if self.allowed_chat_ids and chat_id not in self.allowed_chat_ids:
            return False

        payload = build_telegram_event(
            event,
            account_scope=self.account_scope,
            now_iso=self.now_iso,
        )
        if payload is None:
            return False

        try:
            self.queue.put_nowait(payload)
        except asyncio.QueueFull:
            self._queue_overflows += 1
            self._last_delivery_error_at = self.now_iso()
            if self._connected:
                self._status = 'DEGRADED'
            return False

        self._last_event_at = self.now_iso()
        self._last_message_id = payload['metadata']['native_identity']['message_id']
        return True

    async def _deliver_with_retry(self, payload):
        retry_index = 0
        while True:
            try:
                result = await self.sink(payload)
                if not isinstance(result, dict) or result.get('ok') is not True:
                    raise PermanentV1DeliveryError('INVALID_SINK_RESULT')
                self._delivery_successes += 1
                self._last_delivery_at = self.now_iso()
                if self._connected:
                    self._status = 'HEALTHY'
                return True
            except asyncio.CancelledError:
                raise
            except PermanentV1DeliveryError:
                self._delivery_failures += 1
                self._permanent_rejections += 1
                self._last_delivery_error_at = self.now_iso()
                if self._connected:
                    self._status = 'DEGRADED'
                return False
            except RetryableV1DeliveryError:
                self._delivery_failures += 1
                self._last_delivery_error_at = self.now_iso()
                if self._connected:
                    self._status = 'DEGRADED'
                if retry_index >= len(self.retry_delays):
                    return False
                delay = self.retry_delays[retry_index]
                retry_index += 1
                await self.sleep(delay)
            except Exception:
                self._delivery_failures += 1
                self._last_delivery_error_at = self.now_iso()
                if self._connected:
                    self._status = 'DEGRADED'
                return False

    async def _delivery_worker(self):
        while True:
            payload = await self.queue.get()
            try:
                await self._deliver_with_retry(payload)
            finally:
                self.queue.task_done()

    async def wait_until_idle(self):
        await self.queue.join()

    def health(self):
        return build_health(
            status=self._status,
            connected=self._connected,
            last_event_at=self._last_event_at,
            last_message_id=self._last_message_id,
            queue_depth=self.queue.qsize(),
            delivery_failures=self._delivery_failures,
            delivery_successes=self._delivery_successes,
            permanent_rejections=self._permanent_rejections,
            queue_overflows=self._queue_overflows,
            last_delivery_error_at=self._last_delivery_error_at,
            last_delivery_at=self._last_delivery_at,
            reconnect_count=self._reconnect_count,
        )
