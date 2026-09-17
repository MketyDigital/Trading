import asyncio
import sys
import types
import unittest
from unittest.mock import patch

from adapter import ExternalMtprotoAdapter


class FakeEvent:
    def __init__(self, *, chat_id=-1002366787615, message_id=101, text='SL at BE NOW', outgoing=False, reply_to_message_id=None, edited=False):
        self.chat_id = chat_id
        self.id = message_id
        self.raw_text = text
        self.out = outgoing
        self.message = self
        self.media = None
        self.reply_to_msg_id = reply_to_message_id
        self.reply_to = None
        self.edit_date = object() if edited else None


class FakeClient:
    def __init__(self):
        self.handlers = []

    def add_event_handler(self, handler, event_builder=None):
        self.handlers.append((handler, event_builder))

    async def connect(self):
        return None

    async def is_user_authorized(self):
        return True

    async def catch_up(self):
        return None

    async def disconnect(self):
        return None


class NewMessage:
    pass


class MessageEdited:
    pass


class ProductionLineageRegressionTests(unittest.IsolatedAsyncioTestCase):
    def make_adapter(self):
        client = FakeClient()
        deliveries = []

        async def sink(payload):
            deliveries.append(payload)
            return {'ok': True, 'duplicate': False}

        adapter = ExternalMtprotoAdapter(
            api_id=1,
            api_hash='hash',
            session_string='session',
            source_id='source',
            account_scope='scope',
            allowed_chat_ids=set(),
            client_factory=lambda **_kwargs: client,
            sink=sink,
            retry_delays=(),
            accept_outgoing=True,
        )
        return adapter, client, deliveries

    async def test_self_authored_source_reply_is_not_dropped_and_preserves_reply_coordinate(self):
        adapter, _client, deliveries = self.make_adapter()
        await adapter.start()
        accepted = await adapter.handle_new_message(FakeEvent(
            outgoing=True,
            message_id=102,
            reply_to_message_id=101,
        ))
        await adapter.wait_until_idle()
        await adapter.stop()

        self.assertTrue(accepted)
        self.assertEqual(len(deliveries), 1)
        self.assertEqual(deliveries[0]['thread']['reply_to_event_id'], 'telegram:-1002366787615:101')

    async def test_start_registers_explicit_new_message_and_message_edited_handlers(self):
        adapter, client, _deliveries = self.make_adapter()
        fake_telethon = types.SimpleNamespace(
            events=types.SimpleNamespace(NewMessage=NewMessage, MessageEdited=MessageEdited)
        )
        with patch.dict(sys.modules, {'telethon': fake_telethon}):
            await adapter.start()
            await adapter.stop()

        self.assertEqual(len(client.handlers), 2)
        self.assertIs(client.handlers[0][1], NewMessage)
        self.assertIs(client.handlers[1][1], MessageEdited)


if __name__ == '__main__':
    unittest.main()
