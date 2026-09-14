import asyncio
from contextlib import suppress

from health import build_health, utc_now_iso


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


def _field(value, name):
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _reply_to_message_id(event):
    message = _field(event, 'message')
    reply_header = _field(event, 'reply_to')
    message_reply_header = _field(message, 'reply_to')
    original_update = _field(event, 'original_update')
    original_message = _field(original_update, 'message')
    original_reply_header = _field(original_message, 'reply_to')
    candidates = [
        _field(event, 'reply_to_msg_id'),
        _field(message, 'reply_to_msg_id'),
        _field(reply_header, 'reply_to_msg_id'),
        _field(message_reply_header, 'reply_to_msg_id'),
        _field(original_update, 'reply_to_msg_id'),
        _field(original_message, 'reply_to_msg_id'),
        _field(original_reply_header, 'reply_to_msg_id'),
    ]
    for value in candidates:
        if value is not None and str(value) != '':
            return value
    return None


def _has_reply_hint(event):
    message = _field(event, 'message')
    original_update = _field(event, 'original_update')
    original_message = _field(original_update, 'message')
    return bool(
        _field(event, 'is_reply')
        or _field(event, 'reply_to') is not None
        or _field(message, 'reply_to') is not None
        or _field(original_update, 'reply_to') is not None
        or _field(original_message, 'reply_to') is not None
    )


async def _resolve_reply_to_message_id(event):
    direct = _reply_to_message_id(event)
    if direct is not None:
        return direct
    if not _has_reply_hint(event):
        return None
    getter = getattr(event, 'get_reply_message', None)
    if not callable(getter):
        return None
    try:
        replied = await getter()
    except Exception:
        return None
    value = _field(replied, 'id')
    return value if value is not None and str(value) != '' else None


def _topic_id(event):
    reply_header = _field(event, 'reply_to')
    if reply_header is None:
        reply_header = _field(_field(event, 'message'), 'reply_to')
    if reply_header is None or not _field(reply_header, 'forum_topic'):
        return None
    value = _field(reply_header, 'reply_to_top_id')
    if value is None:
        value = _field(reply_header, 'reply_to_msg_id')
    return None if value is None else str(value)


def _thread_contract(event, chat_id, message_id):
    reply_to_message_id = _reply_to_message_id(event)
    topic_id = _topic_id(event)
    edited = _field(event, 'edit_date') is not None or _field(
        _field(event, 'message'), 'edit_date'
    ) is not None

    return {
        'thread_id': None if topic_id is None else f'telegram:{chat_id}:topic:{topic_id}',
        'reply_to_event_id': _telegram_event_id(chat_id, reply_to_message_id),
        'edited_event_id': _telegram_event_id(chat_id, message_id) if edited else None,
    }


class MtprotoListener:
    """Transport-only Telegram listener.

    It never interprets or executes trades. Telegram callbacks only enqueue a
    compact source event; downstream delivery is handled by a separate task so
    a slow Trading endpoint cannot block Telegram update reception.
    """

    def __init__(
        self,
        *,
        api_id,
        api_hash,
        session_string,
        source_id,
        account_scope,
        configured_chat_ids,
        client_factory=None,
        sink,
        queue_size=256,
        retry_delays=None,
        sleep=None,
    ):
        if not source_id or not account_scope:
            raise ValueError('source_id and account_scope are required')
        if sink is None:
            raise ValueError('sink is required')

        self.api_id = int(api_id)
        self.api_hash = str(api_hash)
        self.session_string = str(session_string or '')
        self.source_id = str(source_id)
        self.account_scope = str(account_scope)
        self.configured_chat_ids = {str(value) for value in configured_chat_ids or []}
        self.client_factory = client_factory or _default_client_factory
        self.sink = sink
        self.queue = asyncio.Queue(maxsize=max(1, int(queue_size)))
        self.retry_delays = tuple(
            max(0, float(delay)) for delay in (
                retry_delays if retry_delays is not None else (0.25, 1.0, 2.0)
            )
        )
        self.sleep = sleep or asyncio.sleep

        self.client = None
        self._worker_task = None
        self._running = False
        self._connected = False
        self._status = 'IDLE'
        self._last_event_at = None
        self._last_message_id = None
        self._restart_count = 0
        self._delivery_failures = 0
        self._delivery_successes = 0
        self._last_delivery_error_at = None
        self._last_delivery_at = None

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
            authorized = await self.client.is_user_authorized()
            if not authorized:
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
        except Exception:
            if self._status != 'ERROR':
                self._status = 'ERROR'
            self._connected = False
            self._running = False
            if self._worker_task:
                self._worker_task.cancel()
                with suppress(asyncio.CancelledError):
                    await self._worker_task
                self._worker_task = None
            raise

    async def stop(self):
        self._running = False
        self._connected = False
        if self._worker_task:
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

        chat_id = str(getattr(event, 'chat_id', ''))
        if self.configured_chat_ids and chat_id not in self.configured_chat_ids:
            return False

        message_id = str(getattr(event, 'id', ''))
        if not chat_id or not message_id:
            return False

        payload = {
            'source_id': self.source_id,
            'source_external_id': self.account_scope,
            'external_event_id': f'telegram:{chat_id}:{message_id}',
            'occurred_at': utc_now_iso(),
            'text': str(getattr(event, 'raw_text', '') or ''),
            'thread': _thread_contract(event, chat_id, message_id),
            'metadata': {
                'native_identity': {
                    'chat_id': chat_id,
                    'message_id': message_id,
                },
                'account_scope': self.account_scope,
                'media': getattr(getattr(event, 'message', None), 'media', None) is not None,
            },
        }

        if payload['thread'].get('reply_to_event_id') is None:
            reply_to_message_id = await _resolve_reply_to_message_id(event)
            if reply_to_message_id is not None:
                payload['thread']['reply_to_event_id'] = _telegram_event_id(chat_id, reply_to_message_id)

        self.queue.put_nowait(payload)
        self._last_event_at = utc_now_iso()
        self._last_message_id = message_id
        return True

    async def _deliver_with_retry(self, payload):
        attempt = 0
        while True:
            try:
                await self.sink(payload)
                self._delivery_successes += 1
                self._last_delivery_at = utc_now_iso()
                if self._connected:
                    self._status = 'HEALTHY'
                return True
            except Exception:
                self._delivery_failures += 1
                self._last_delivery_error_at = utc_now_iso()
                if self._connected:
                    self._status = 'DEGRADED'

                if attempt >= len(self.retry_delays):
                    return False

                delay = self.retry_delays[attempt]
                attempt += 1
                await self.sleep(delay)

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
            restart_count=self._restart_count,
            queue_depth=self.queue.qsize(),
            delivery_failures=self._delivery_failures,
            delivery_successes=self._delivery_successes,
            last_delivery_error_at=self._last_delivery_error_at,
            last_delivery_at=self._last_delivery_at,
        )