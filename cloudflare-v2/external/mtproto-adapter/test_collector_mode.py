import unittest

import app
from v1_sink import PermanentV1DeliveryError, RetryableV1DeliveryError, create_collector_sink


EVENT = {
    'external_event_id': 'telegram:-10012345:9876',
    'text': 'BUY XAUUSD',
    'metadata': {'native_identity': {'chat_id': '-10012345', 'message_id': '9876'}},
}


class TransportRecorder:
    def __init__(self, response=(202, b'{"ok":true,"accepted":true,"ignored":false}')):
        self.calls = []
        self.response = response

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


class CollectorModeTests(unittest.IsolatedAsyncioTestCase):
    def test_config_uses_collector_mode_without_per_source_identity_or_secret(self):
        config = app.load_config({
            'TELEGRAM_API_ID': '12345',
            'TELEGRAM_API_HASH': 'hash',
            'TELEGRAM_SESSION': 'session',
            'TRADING_ENDPOINT': 'https://trade.example/api/v1/external/mtproto/collect',
            'TRADING_COLLECTOR_TOKEN': 'collector-token',
            'TELEGRAM_ACCOUNT_SCOPE': 'telegram-account-42',
        })
        self.assertEqual(config['transport_mode'], 'collector')
        self.assertEqual(config['collector_token'], 'collector-token')
        self.assertEqual(config['source_id'], 'shared-mtproto-collector')
        self.assertNotIn('source_secret', config)
        self.assertEqual(config['allowed_chat_ids'], set())

    def test_legacy_signed_source_mode_remains_supported(self):
        config = app.load_config({
            'TELEGRAM_API_ID': '12345',
            'TELEGRAM_API_HASH': 'hash',
            'TELEGRAM_SESSION': 'session',
            'TRADING_ENDPOINT': 'https://trade.example/api/v1/events',
            'TRADING_SOURCE_ID': 'source-1',
            'TRADING_SOURCE_SECRET': 'source-secret',
        })
        self.assertEqual(config['transport_mode'], 'signed_source')
        self.assertEqual(config['source_id'], 'source-1')
        self.assertEqual(config['source_secret'], 'source-secret')

    def test_config_rejects_partial_auth_mode_instead_of_guessing(self):
        with self.assertRaisesRegex(ValueError, 'TRADING_SOURCE_SECRET'):
            app.load_config({
                'TELEGRAM_API_ID': '12345',
                'TELEGRAM_API_HASH': 'hash',
                'TELEGRAM_SESSION': 'session',
                'TRADING_ENDPOINT': 'https://trade.example/api/v1/external/mtproto/collect',
                'TRADING_SOURCE_ID': 'source-1',
            })

    async def test_collector_sink_sends_bearer_token_and_accepts_202(self):
        transport = TransportRecorder()
        sink = create_collector_sink(
            endpoint='https://trade.example/api/v1/external/mtproto/collect',
            collector_token='collector-token',
            transport=transport,
        )
        result = await sink(EVENT)
        self.assertTrue(result['ok'])
        call = transport.calls[0]
        self.assertEqual(call['headers']['Authorization'], 'Bearer collector-token')
        self.assertNotIn('X-Mkety-Source-Id', call['headers'])
        self.assertNotIn('X-Mkety-Signature', call['headers'])
        self.assertNotIn('collector-token', call['body'].decode('utf-8'))

    async def test_collector_sink_retries_server_outage_and_treats_auth_rejection_as_permanent(self):
        retry = create_collector_sink(
            endpoint='https://trade.example/api/v1/external/mtproto/collect',
            collector_token='collector-token',
            transport=TransportRecorder((503, b'{"ok":false}')),
        )
        with self.assertRaises(RetryableV1DeliveryError):
            await retry(EVENT)

        rejected = create_collector_sink(
            endpoint='https://trade.example/api/v1/external/mtproto/collect',
            collector_token='collector-token',
            transport=TransportRecorder((401, b'{"ok":false}')),
        )
        with self.assertRaises(PermanentV1DeliveryError):
            await rejected(EVENT)


if __name__ == '__main__':
    unittest.main()
