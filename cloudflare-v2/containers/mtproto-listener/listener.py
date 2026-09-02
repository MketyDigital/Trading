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

        self.client = None
        self._worker_task = None
        self._running = False
        self._connected = False
        self._status = 'IDLE'
        self._last_event_at = None
        self._last_message_id = None
        self._restart_count = 0

    async def start(self):
        if self._running:
            return self.health()

        self._status = 'STARTING'
        self.client = self.client_factory(
            api_id=self.api_id,
            api_hash=self.api_hash,
            session_string=self.session_string,
        )

        # Register before catch-up so replayed updates use the exact same path as
        # live updates and therefore share idempotency/canonical identity rules.
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

            # Telethon's catch_up() retrieves updates missed while the session
            # was offline and dispatches them to the registered handlers.
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
            'metadata': {
                'native_identity': {
                    'chat_id': chat_id,
                    'message_id': message_id,
                },
                'account_scope': self.account_scope,
                'media': getattr(getattr(event, 'message', None), 'media', None) is not None,
            },
        }

        # Intentionally do not await downstream network work here. A bounded
        # queue applies backpressure locally without coupling the Telegram
        # receive loop to Trading processing latency.
        self.queue.put_nowait(payload)
        self._last_event_at = utc_now_iso()
        self._last_message_id = message_id
        return True

    async def _delivery_worker(self):
        while True:
            payload = await self.queue.get()
            try:
                await self.sink(payload)
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
        )
