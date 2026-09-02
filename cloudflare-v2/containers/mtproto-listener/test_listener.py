import asyncio
import unittest

from listener import MtprotoListener


class FakeEvent:
    def __init__(
        self,
        *,
        chat_id,
        message_id,
        text='BUY GOLD NOW',
        outgoing=False,
        reply_to_message_id=None,
        topic_id=None,
        edited=False,
    ):
        self.chat_id = chat_id
        self.id = message_id
        self.raw_text = text
        self.out = outgoing
        self.message = self
        self.media = None
        self.reply_to_msg_id = reply_to_message_id
        self.is_topic_message = topic_id is not None
        self.reply_to = None if topic_id is None else type('ReplyHeader', (), {'forum_topic': True, 'reply_to_top_id': topic_id})()
        self.edit_date = object() if edited else None


class FakeClient:
    def __init__(self):
        self.handlers = []
        self.connected = False
        self.authorized = True
        self.catch_up_calls = 0

    def add_event_handler(self, handler, event_builder=None):
        self.handlers.append((handler, event_builder))

    async def connect(self):
        self.connected = True

    async def is_user_authorized(self):
        return self.authorized

    async def catch_up(self):
        self.catch_up_calls += 1

    async def disconnect(self):
        self.connected = False


class MtprotoListenerTests(unittest.IsolatedAsyncioTestCase):
    def make_listener(self, *, sink=None, chats=None, session='saved-session'):
        client = FakeClient()
        factory_calls = []

        def client_factory(**kwargs):
            factory_calls.append(kwargs)
            return client

        delivered = []

        async def default_sink(payload):
            delivered.append(payload)

        listener = MtprotoListener(
            api_id=12345,
            api_hash='private-api-hash',
            session_string=session,
            source_id='source-1',
            account_scope='telegram-account-42',
            configured_chat_ids=chats or {-1001, -1002},
            client_factory=client_factory,
            sink=sink or default_sink,
            queue_size=10,
        )
        return listener, client, factory_calls, delivered

    async def test_one_session_accepts_multiple_configured_chats_and_preserves_native_identity(self):
        listener, _, _, delivered = self.make_listener()
        await listener.start()

        await listener.handle_new_message(FakeEvent(chat_id=-1001, message_id=10, text='BUY GOLD NOW'))
        await listener.handle_new_message(FakeEvent(chat_id=-1002, message_id=11, text='SL 2300 TP 2400'))
        await listener.wait_until_idle()

        self.assertEqual(len(delivered), 2)
        self.assertEqual(delivered[0]['metadata']['native_identity'], {'chat_id': '-1001', 'message_id': '10'})
        self.assertEqual(delivered[1]['metadata']['native_identity'], {'chat_id': '-1002', 'message_id': '11'})
        self.assertEqual(delivered[0]['source_id'], 'source-1')
        await listener.stop()

    async def test_preserves_reply_topic_and_edit_identity_for_trade_correlation(self):
        listener, _, _, delivered = self.make_listener()
        await listener.start()

        await listener.handle_new_message(FakeEvent(
            chat_id=-1001,
            message_id=77,
            text='MOVE SL TO BE',
            reply_to_message_id=76,
            topic_id=55,
            edited=True,
        ))
        await listener.wait_until_idle()

        self.assertEqual(len(delivered), 1)
        self.assertEqual(delivered[0]['thread'], {
            'thread_id': 'telegram:-1001:topic:55',
            'reply_to_event_id': 'telegram:-1001:76',
            'edited_event_id': 'telegram:-1001:77',
        })
        self.assertEqual(delivered[0]['metadata']['account_scope'], 'telegram-account-42')
        await listener.stop()

    async def test_plain_message_emits_explicit_empty_thread_contract(self):
        listener, _, _, delivered = self.make_listener()
        await listener.start()

        await listener.handle_new_message(FakeEvent(chat_id=-1001, message_id=78))
        await listener.wait_until_idle()

        self.assertEqual(delivered[0]['thread'], {
            'thread_id': None,
            'reply_to_event_id': None,
            'edited_event_id': None,
        })
        await listener.stop()

    async def test_outgoing_and_unconfigured_chat_messages_are_ignored(self):
        listener, _, _, delivered = self.make_listener()
        await listener.start()

        await listener.handle_new_message(FakeEvent(chat_id=-1001, message_id=1, outgoing=True))
        await listener.handle_new_message(FakeEvent(chat_id=-9999, message_id=2))
        await listener.wait_until_idle()

        self.assertEqual(delivered, [])
        await listener.stop()

    async def test_receive_handler_does_not_wait_for_slow_downstream_delivery(self):
        gate = asyncio.Event()
        started = asyncio.Event()
        delivered = []

        async def slow_sink(payload):
            started.set()
            await gate.wait()
            delivered.append(payload)

        listener, _, _, _ = self.make_listener(sink=slow_sink)
        await listener.start()

        await asyncio.wait_for(
            listener.handle_new_message(FakeEvent(chat_id=-1001, message_id=77)),
            timeout=0.05,
        )
        await asyncio.wait_for(started.wait(), timeout=0.05)
        self.assertEqual(delivered, [])

        gate.set()
        await listener.wait_until_idle()
        self.assertEqual(len(delivered), 1)
        await listener.stop()

    async def test_start_restores_session_registers_handler_then_catches_up(self):
        listener, client, factory_calls, _ = self.make_listener(session='restored-session')

        await listener.start()

        self.assertEqual(factory_calls[0]['session_string'], 'restored-session')
        self.assertEqual(factory_calls[0]['api_id'], 12345)
        self.assertEqual(factory_calls[0]['api_hash'], 'private-api-hash')
        self.assertEqual(len(client.handlers), 1)
        self.assertEqual(client.catch_up_calls, 1)
        self.assertTrue(listener.health()['connected'])
        await listener.stop()

    async def test_unauthorized_session_fails_closed_without_exposing_credentials(self):
        listener, client, _, _ = self.make_listener()
        client.authorized = False

        with self.assertRaisesRegex(RuntimeError, 'not authorized'):
            await listener.start()

        health = listener.health()
        serialized = repr(health)
        self.assertEqual(health['status'], 'ERROR')
        self.assertNotIn('private-api-hash', serialized)
        self.assertNotIn('saved-session', serialized)

    async def test_health_is_sanitized_and_tracks_last_event(self):
        listener, _, _, _ = self.make_listener()
        await listener.start()
        await listener.handle_new_message(FakeEvent(chat_id=-1001, message_id=91))
        await listener.wait_until_idle()

        health = listener.health()
        self.assertEqual(health['status'], 'HEALTHY')
        self.assertTrue(health['connected'])
        self.assertEqual(health['last_message_id'], '91')
        self.assertIsNotNone(health['last_event_at'])
        self.assertNotIn('api_hash', health)
        self.assertNotIn('session_string', health)
        await listener.stop()


if __name__ == '__main__':
    unittest.main()
