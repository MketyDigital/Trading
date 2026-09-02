import asyncio
import os
import unittest

from adapter import ExternalMtprotoAdapter, build_telegram_event
from app import format_fatal_error, load_config
from v1_sink import PermanentV1DeliveryError, RetryableV1DeliveryError


FIXED_NOW = '2026-09-02T12:00:00.000000Z'


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
        media=False,
    ):
        self.chat_id = chat_id
        self.id = message_id
        self.raw_text = text
        self.out = outgoing
        self.message = self
        self.media = object() if media else None
        self.reply_to_msg_id = reply_to_message_id
        self.reply_to = None if topic_id is None else type(
            'ReplyHeader', (), {'forum_topic': True, 'reply_to_top_id': topic_id}
        )()
        self.edit_date = object() if edited else None


class FakeClient:
    def __init__(self):
        self.handlers = []
        self.connected = False
        self.authorized = True
        self.catch_up_calls = 0
        self.disconnect_calls = 0

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
        self.disconnect_calls += 1


class ConfigTests(unittest.TestCase):
    def valid_env(self, **overrides):
        env = {
            'TELEGRAM_API_ID': '12345',
            'TELEGRAM_API_HASH': 'api-hash-secret',
            'TELEGRAM_SESSION': 'telegram-session-secret',
            'TRADING_ENDPOINT': 'https://trade.example/api/v1/events',
            'TRADING_SOURCE_ID': 'src-ext',
            'TRADING_SOURCE_SECRET': 'source-hmac-secret',
        }
        env.update(overrides)
        return env

    def test_required_configuration_reports_variable_names_only(self):
        env = self.valid_env()
        del env['TELEGRAM_API_HASH']
        del env['TRADING_SOURCE_SECRET']

        with self.assertRaises(ValueError) as caught:
            load_config(env)

        message = str(caught.exception)
        self.assertIn('TELEGRAM_API_HASH', message)
        self.assertIn('TRADING_SOURCE_SECRET', message)
        self.assertNotIn('telegram-session-secret', message)
        self.assertNotIn('source-hmac-secret', message)

    def test_optional_local_filter_and_account_scope_are_parsed_without_becoming_authority(self):
        config = load_config(self.valid_env(
            ALLOWED_CHAT_IDS=' -1001, -1002, -1001 ',
            TELEGRAM_ACCOUNT_SCOPE='telegram-account-42',
        ))
        self.assertEqual(config['allowed_chat_ids'], {'-1001', '-1002'})
        self.assertEqual(config['account_scope'], 'telegram-account-42')
        self.assertNotIn('workspace_id', config)

        forward_all = load_config(self.valid_env(ALLOWED_CHAT_IDS=''))
        self.assertEqual(forward_all['allowed_chat_ids'], set())

    def test_fatal_error_format_never_echoes_arbitrary_runtime_exception_text(self):
        secret_values = 'telegram-session-secret source-hmac-secret api-hash-secret'
        rendered = format_fatal_error(RuntimeError(secret_values))
        self.assertIn('RuntimeError', rendered)
        self.assertIn('external MTProto adapter stopped', rendered)
        self.assertNotIn('telegram-session-secret', rendered)
        self.assertNotIn('source-hmac-secret', rendered)
        self.assertNotIn('api-hash-secret', rendered)


class ExternalAdapterTests(unittest.IsolatedAsyncioTestCase):
    def make_adapter(
        self,
        *,
        sink=None,
        allowed_chat_ids=None,
        account_scope='telegram-account-42',
        retry_delays=(1, 2, 5),
        sleep=None,
        queue_size=8,
    ):
        client = FakeClient()
        factory_calls = []
        deliveries = []

        def client_factory(**kwargs):
            factory_calls.append(kwargs)
            return client

        async def default_sink(payload):
            deliveries.append(payload)
            return {'ok': True, 'duplicate': False}

        adapter = ExternalMtprotoAdapter(
            api_id=12345,
            api_hash='private-api-hash',
            session_string='private-session',
            source_id='src-ext',
            account_scope=account_scope,
            allowed_chat_ids=allowed_chat_ids,
            client_factory=client_factory,
            sink=sink or default_sink,
            queue_size=queue_size,
            retry_delays=retry_delays,
            sleep=sleep,
            now_iso=lambda: FIXED_NOW,
        )
        return adapter, client, factory_calls, deliveries

    async def test_start_restores_session_registers_handler_before_catch_up_and_health_is_secret_free(self):
        adapter, client, factory_calls, _ = self.make_adapter()
        health = await adapter.start()

        self.assertEqual(factory_calls[0], {
            'api_id': 12345,
            'api_hash': 'private-api-hash',
            'session_string': 'private-session',
        })
        self.assertEqual(len(client.handlers), 1)
        self.assertEqual(client.catch_up_calls, 1)
        self.assertTrue(health['connected'])
        rendered = repr(health)
        self.assertNotIn('private-api-hash', rendered)
        self.assertNotIn('private-session', rendered)
        self.assertNotIn('source-hmac-secret', rendered)
        await adapter.stop()

    async def test_absent_local_allowlist_forwards_multiple_chats_and_outgoing_is_ignored(self):
        adapter, _, _, deliveries = self.make_adapter(allowed_chat_ids=set())
        await adapter.start()

        self.assertTrue(await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=10)))
        self.assertTrue(await adapter.handle_new_message(FakeEvent(chat_id=-2002, message_id=11)))
        self.assertFalse(await adapter.handle_new_message(FakeEvent(chat_id=-3003, message_id=12, outgoing=True)))
        await adapter.wait_until_idle()

        self.assertEqual(len(deliveries), 2)
        self.assertEqual(deliveries[0]['metadata']['native_identity'], {'chat_id': '-1001', 'message_id': '10'})
        self.assertEqual(deliveries[1]['metadata']['native_identity'], {'chat_id': '-2002', 'message_id': '11'})
        for payload in deliveries:
            self.assertNotIn('workspace_id', payload)
            self.assertNotIn('source_id', payload)
            self.assertNotIn('forward_all', payload.get('metadata', {}))
            self.assertNotIn('chat_acceptance_mode', payload.get('metadata', {}))
        await adapter.stop()

    async def test_configured_local_allowlist_filters_only_selected_chats(self):
        adapter, _, _, deliveries = self.make_adapter(allowed_chat_ids={'-1001'})
        await adapter.start()
        self.assertTrue(await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=1)))
        self.assertFalse(await adapter.handle_new_message(FakeEvent(chat_id=-1002, message_id=2)))
        await adapter.wait_until_idle()
        self.assertEqual(len(deliveries), 1)
        await adapter.stop()

    async def test_event_contract_matches_container_semantics_for_native_thread_edit_media_and_timestamp(self):
        event = FakeEvent(
            chat_id=-1001,
            message_id=77,
            text='MOVE SL TO BE',
            reply_to_message_id=76,
            topic_id=55,
            edited=True,
            media=True,
        )
        payload = build_telegram_event(
            event,
            account_scope='telegram-account-42',
            now_iso=lambda: FIXED_NOW,
        )

        expected_container_semantics = {
            'external_event_id': 'telegram:-1001:77',
            'occurred_at': FIXED_NOW,
            'text': 'MOVE SL TO BE',
            'thread': {
                'thread_id': 'telegram:-1001:topic:55',
                'reply_to_event_id': 'telegram:-1001:76',
                'edited_event_id': 'telegram:-1001:77',
            },
            'metadata': {
                'native_identity': {'chat_id': '-1001', 'message_id': '77'},
                'account_scope': 'telegram-account-42',
                'media': True,
            },
        }
        self.assertEqual(payload, expected_container_semantics)

    async def test_account_scope_is_optional_local_self_check_not_a_required_body_authority(self):
        payload = build_telegram_event(
            FakeEvent(chat_id=-1001, message_id=9),
            account_scope=None,
            now_iso=lambda: FIXED_NOW,
        )
        self.assertNotIn('account_scope', payload['metadata'])
        self.assertEqual(payload['metadata']['native_identity']['chat_id'], '-1001')

    async def test_receive_callback_does_not_wait_for_network_delivery_and_queue_is_bounded(self):
        gate = asyncio.Event()
        started = asyncio.Event()

        async def slow_sink(_payload):
            started.set()
            await gate.wait()
            return {'ok': True, 'duplicate': False}

        adapter, _, _, _ = self.make_adapter(sink=slow_sink, queue_size=1)
        await adapter.start()
        await asyncio.wait_for(adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=1)), timeout=0.05)
        await asyncio.wait_for(started.wait(), timeout=0.05)
        self.assertTrue(await asyncio.wait_for(
            adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=2)),
            timeout=0.05,
        ))
        self.assertFalse(await asyncio.wait_for(
            adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=3)),
            timeout=0.05,
        ))
        self.assertEqual(adapter.health()['queue_depth'], 1)
        gate.set()
        await adapter.wait_until_idle()
        await adapter.stop()

    async def test_retryable_failure_retries_same_event_with_source_local_capped_delays(self):
        attempts = []
        sleeps = []

        async def flaky_sink(payload):
            attempts.append(payload)
            if len(attempts) < 3:
                raise RetryableV1DeliveryError('HTTP_503', status=503)
            return {'ok': True, 'duplicate': False}

        async def fake_sleep(delay):
            sleeps.append(delay)

        adapter, _, _, _ = self.make_adapter(sink=flaky_sink, retry_delays=(1, 2, 5), sleep=fake_sleep)
        await adapter.start()
        await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=101))
        await adapter.wait_until_idle()

        self.assertEqual(len(attempts), 3)
        self.assertIs(attempts[0], attempts[1])
        self.assertIs(attempts[1], attempts[2])
        self.assertEqual(sleeps, [1, 2])
        health = adapter.health()
        self.assertEqual(health['delivery_failures'], 2)
        self.assertEqual(health['delivery_successes'], 1)
        self.assertEqual(health['status'], 'HEALTHY')
        await adapter.stop()

    async def test_permanent_rejection_does_not_hot_loop_and_worker_continues(self):
        attempts = []

        async def sink(payload):
            attempts.append(payload['external_event_id'])
            if payload['external_event_id'].endswith(':1'):
                raise PermanentV1DeliveryError('HTTP_403', status=403)
            return {'ok': True, 'duplicate': False}

        adapter, _, _, _ = self.make_adapter(sink=sink)
        await adapter.start()
        await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=1))
        await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=2))
        await adapter.wait_until_idle()

        self.assertEqual(attempts, ['telegram:-1001:1', 'telegram:-1001:2'])
        health = adapter.health()
        self.assertEqual(health['permanent_rejections'], 1)
        self.assertEqual(health['delivery_successes'], 1)
        await adapter.stop()

    async def test_duplicate_terminal_success_counts_as_successful_delivery(self):
        async def duplicate_sink(_payload):
            return {'ok': True, 'duplicate': True}

        adapter, _, _, _ = self.make_adapter(sink=duplicate_sink)
        await adapter.start()
        await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=4))
        await adapter.wait_until_idle()
        health = adapter.health()
        self.assertEqual(health['delivery_successes'], 1)
        self.assertEqual(health['delivery_failures'], 0)
        await adapter.stop()

    async def test_two_adapter_instances_isolate_retry_state_and_network_blocking(self):
        retry_gate = asyncio.Event()
        a_started = asyncio.Event()
        b_delivered = asyncio.Event()

        async def sink_a(_payload):
            a_started.set()
            await retry_gate.wait()
            raise RetryableV1DeliveryError('HTTP_503', status=503)

        async def sink_b(_payload):
            b_delivered.set()
            return {'ok': True, 'duplicate': False}

        async def blocking_sleep(_delay):
            await retry_gate.wait()

        adapter_a, _, _, _ = self.make_adapter(sink=sink_a, retry_delays=(1,), sleep=blocking_sleep)
        adapter_b, _, _, _ = self.make_adapter(sink=sink_b)
        await adapter_a.start()
        await adapter_b.start()

        await adapter_a.handle_new_message(FakeEvent(chat_id=-1001, message_id=1))
        await asyncio.wait_for(a_started.wait(), timeout=0.05)
        await adapter_b.handle_new_message(FakeEvent(chat_id=-2002, message_id=2))
        await asyncio.wait_for(b_delivered.wait(), timeout=0.05)
        await asyncio.wait_for(adapter_b.wait_until_idle(), timeout=0.05)
        self.assertEqual(adapter_b.health()['delivery_successes'], 1)
        self.assertEqual(adapter_b.health()['delivery_failures'], 0)

        retry_gate.set()
        await adapter_a.wait_until_idle()
        await adapter_a.stop()
        await adapter_b.stop()

    async def test_stop_cancellation_is_clean_and_not_recorded_as_delivery_failure(self):
        gate = asyncio.Event()

        async def slow_sink(_payload):
            await gate.wait()
            return {'ok': True}

        adapter, _, _, _ = self.make_adapter(sink=slow_sink)
        await adapter.start()
        await adapter.handle_new_message(FakeEvent(chat_id=-1001, message_id=1))
        await asyncio.sleep(0)
        before = adapter.health()['delivery_failures']
        await adapter.stop(drain=False)
        after = adapter.health()['delivery_failures']
        self.assertEqual(after, before)
        self.assertEqual(adapter.health()['status'], 'STOPPED')


if __name__ == '__main__':
    unittest.main()
