import unittest

from adapter import ExternalMtprotoAdapter


class _Reply:
    def __init__(self, message_id):
        self.id = message_id


class _Event:
    def __init__(self):
        self.chat_id = -1001
        self.id = 50
        self.raw_text = 'close'
        self.out = False
        self.message = self
        self.media = None
        self.reply_to_msg_id = None
        self.reply_to = None
        self.edit_date = None
        self.is_reply = True

    async def get_reply_message(self):
        return _Reply(49)


class _Client:
    async def connect(self):
        return None

    async def is_user_authorized(self):
        return True

    async def catch_up(self):
        return None

    async def disconnect(self):
        return None

    def add_event_handler(self, *_args, **_kwargs):
        return None


class ReplyFallbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_handle_new_message_resolves_reply_when_telegram_header_fields_are_missing(self):
        deliveries = []

        async def sink(payload):
            deliveries.append(payload)
            return {'ok': True, 'duplicate': False}

        adapter = ExternalMtprotoAdapter(
            api_id=1,
            api_hash='hash',
            session_string='session',
            source_id='source-1',
            client_factory=lambda **_kwargs: _Client(),
            sink=sink,
            retry_delays=(),
        )
        await adapter.start()
        self.assertTrue(await adapter.handle_new_message(_Event()))
        await adapter.wait_until_idle()
        self.assertEqual(deliveries[0]['thread']['reply_to_event_id'], 'telegram:-1001:49')
        await adapter.stop()


if __name__ == '__main__':
    unittest.main()
