import unittest

from listener import MtprotoListener


class _Reply:
    def __init__(self, message_id):
        self.id = message_id


class _ReplyHeader:
    def __init__(self, message_id):
        self.reply_to_msg_id = message_id
        self.forum_topic = False
        self.reply_to_top_id = None


class _WrappedMessage:
    def __init__(self, reply_to_message_id):
        self.reply_to_msg_id = None
        self.reply_to = _ReplyHeader(reply_to_message_id)
        self.media = None
        self.edit_date = None


class _OriginalUpdate:
    def __init__(self, reply_to_message_id):
        self.message = _WrappedMessage(reply_to_message_id)


class _FallbackEvent:
    chat_id = -1001
    id = 50
    raw_text = 'close'
    out = False
    media = None
    reply_to_msg_id = None
    reply_to = None
    edit_date = None
    is_reply = True

    def __init__(self):
        self.message = self

    async def get_reply_message(self):
        return _Reply(49)


class _WrappedEvent(_FallbackEvent):
    def __init__(self):
        super().__init__()
        self.is_reply = False
        self.original_update = _OriginalUpdate(48)

    async def get_reply_message(self):
        raise AssertionError('wrapped reply metadata should be used before fallback lookup')


class _Client:
    def add_event_handler(self, *_args, **_kwargs):
        return None

    async def connect(self):
        return None

    async def is_user_authorized(self):
        return True

    async def catch_up(self):
        return None

    async def disconnect(self):
        return None


class ReplyFallbackTest(unittest.IsolatedAsyncioTestCase):
    def make_listener(self, deliveries):
        async def sink(payload):
            deliveries.append(payload)

        return MtprotoListener(
            api_id=1,
            api_hash='hash',
            session_string='session',
            source_id='source-1',
            account_scope='telegram-account-42',
            configured_chat_ids={-1001},
            client_factory=lambda **_kwargs: _Client(),
            sink=sink,
            retry_delays=(),
        )

    async def test_resolves_reply_via_get_reply_message_when_header_fields_are_missing(self):
        deliveries = []
        listener = self.make_listener(deliveries)
        await listener.start()
        self.assertTrue(await listener.handle_new_message(_FallbackEvent()))
        await listener.wait_until_idle()
        self.assertEqual(deliveries[0]['thread']['reply_to_event_id'], 'telegram:-1001:49')
        await listener.stop()

    async def test_preserves_wrapped_original_update_reply_metadata(self):
        deliveries = []
        listener = self.make_listener(deliveries)
        await listener.start()
        self.assertTrue(await listener.handle_new_message(_WrappedEvent()))
        await listener.wait_until_idle()
        self.assertEqual(deliveries[0]['thread']['reply_to_event_id'], 'telegram:-1001:48')
        await listener.stop()


if __name__ == '__main__':
    unittest.main()
