import asyncio
import json
import unittest

from v1_sink import (
    PermanentV1DeliveryError,
    RetryableV1DeliveryError,
    create_signed_v1_sink,
)


EVENT = {
    'external_event_id': 'telegram:-10012345:9876',
    'text': 'BUY XAUUSD',
    'metadata': {
        'native_identity': {
            'chat_id': '-10012345',
            'message_id': '9876',
        },
    },
}
EXPECTED_BODY = (
    b'{"external_event_id":"telegram:-10012345:9876",'
    b'"metadata":{"native_identity":{"chat_id":"-10012345","message_id":"9876"}},'
    b'"text":"BUY XAUUSD"}'
)
EXPECTED_SIGNATURE = 'v1=878f4dd78692511298f2c7c54a2e041c7830efee286ced8e78cd7030f158fd05'


class TransportRecorder:
    def __init__(self, responses=None):
        self.calls = []
        self.responses = list(responses or [(200, b'{"ok":true,"duplicate":false}')])

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        response = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        if isinstance(response, BaseException):
            raise response
        return response


class SignedV1SinkTests(unittest.IsolatedAsyncioTestCase):
    async def test_serializes_compact_stable_body_and_matches_js_hmac_fixture(self):
        transport = TransportRecorder()
        sink = create_signed_v1_sink(
            endpoint='https://trade.example/api/v1/events',
            source_id='src-ext',
            source_secret='source-secret',
            transport=transport,
            now_ms=lambda: 1700000000123,
        )

        result = await sink(EVENT)
        self.assertEqual(result, {'ok': True, 'duplicate': False})
        call = transport.calls[0]
        self.assertEqual(call['url'], 'https://trade.example/api/v1/events')
        self.assertEqual(call['body'], EXPECTED_BODY)
        self.assertEqual(call['headers']['X-Mkety-Source-Id'], 'src-ext')
        self.assertEqual(call['headers']['X-Mkety-Timestamp'], '1700000000123')
        self.assertEqual(call['headers']['X-Mkety-Signature'], EXPECTED_SIGNATURE)
        auth_headers = {key for key in call['headers'] if key.startswith('X-Mkety-')}
        self.assertEqual(auth_headers, {
            'X-Mkety-Source-Id',
            'X-Mkety-Timestamp',
            'X-Mkety-Signature',
        })

    async def test_same_event_keeps_body_byte_stable_while_timestamp_and_signature_refresh(self):
        timestamps = iter([1700000000123, 1700000000456])
        transport = TransportRecorder(responses=[
            (503, b'{"ok":false,"reason":"TEMPORARY"}'),
            (200, b'{"ok":true,"duplicate":true}'),
        ])
        sink = create_signed_v1_sink(
            endpoint='https://trade.example/api/v1/events',
            source_id='src-ext',
            source_secret='source-secret',
            transport=transport,
            now_ms=lambda: next(timestamps),
        )

        with self.assertRaises(RetryableV1DeliveryError):
            await sink(EVENT)
        result = await sink(EVENT)
        self.assertTrue(result['duplicate'])
        first, second = transport.calls
        self.assertEqual(first['body'], second['body'])
        self.assertEqual(first['body'], EXPECTED_BODY)
        self.assertNotEqual(first['headers']['X-Mkety-Timestamp'], second['headers']['X-Mkety-Timestamp'])
        self.assertNotEqual(first['headers']['X-Mkety-Signature'], second['headers']['X-Mkety-Signature'])

    async def test_duplicate_and_first_acceptance_are_both_terminal_success(self):
        for response in [
            (200, b'{"ok":true,"duplicate":false,"eventId":"evt-1"}'),
            (200, b'{"ok":true,"duplicate":true,"eventId":"evt-1"}'),
            (202, b'{"ok":true,"duplicate":false}'),
        ]:
            with self.subTest(response=response):
                transport = TransportRecorder([response])
                sink = create_signed_v1_sink(
                    endpoint='https://trade.example/api/v1/events',
                    source_id='src-ext',
                    source_secret='source-secret',
                    transport=transport,
                    now_ms=lambda: 1700000000123,
                )
                result = await sink(EVENT)
                self.assertTrue(result['ok'])
                self.assertEqual(len(transport.calls), 1)

    async def test_network_429_and_5xx_failures_are_retryable_and_sanitized(self):
        secret = 'do-not-leak-source-secret'
        cases = [
            OSError('socket unavailable'),
            (429, b'{"ok":false,"reason":"RATE_LIMITED"}'),
            (500, b'upstream unavailable'),
            (503, b'{"ok":false}'),
        ]
        for response in cases:
            with self.subTest(response=response):
                transport = TransportRecorder([response])
                sink = create_signed_v1_sink(
                    endpoint='https://trade.example/api/v1/events',
                    source_id='src-ext',
                    source_secret=secret,
                    transport=transport,
                    now_ms=lambda: 1700000000123,
                )
                with self.assertRaises(RetryableV1DeliveryError) as caught:
                    await sink(EVENT)
                rendered = repr(caught.exception) + str(caught.exception)
                self.assertNotIn(secret, rendered)
                self.assertNotIn('v1=', rendered)

    async def test_permanent_auth_policy_and_payload_failures_do_not_request_retry(self):
        for status in [400, 401, 403, 404, 422]:
            with self.subTest(status=status):
                transport = TransportRecorder([(status, b'{"ok":false,"reason":"REJECTED"}')])
                sink = create_signed_v1_sink(
                    endpoint='https://trade.example/api/v1/events',
                    source_id='src-ext',
                    source_secret='source-secret',
                    transport=transport,
                    now_ms=lambda: 1700000000123,
                )
                with self.assertRaises(PermanentV1DeliveryError):
                    await sink(EVENT)

    async def test_malformed_success_response_fails_closed_without_secret_or_header_leakage(self):
        secret = 'hidden-source-secret'
        for response_body in [b'', b'not-json', b'[]', b'{"ok":false}', b'{"duplicate":true}']:
            with self.subTest(response_body=response_body):
                transport = TransportRecorder([(200, response_body)])
                sink = create_signed_v1_sink(
                    endpoint='https://trade.example/api/v1/events',
                    source_id='src-ext',
                    source_secret=secret,
                    transport=transport,
                    now_ms=lambda: 1700000000123,
                )
                with self.assertRaises(PermanentV1DeliveryError) as caught:
                    await sink(EVENT)
                rendered = repr(caught.exception) + str(caught.exception)
                self.assertNotIn(secret, rendered)
                self.assertNotIn(EXPECTED_SIGNATURE, rendered)
                self.assertNotIn('X-Mkety-Signature', rendered)

    async def test_source_secret_never_enters_body_or_returned_result(self):
        secret = 'never-put-this-in-json'
        transport = TransportRecorder([(200, b'{"ok":true,"duplicate":false,"eventId":"evt-7"}')])
        sink = create_signed_v1_sink(
            endpoint='https://trade.example/api/v1/events',
            source_id='src-ext',
            source_secret=secret,
            transport=transport,
            now_ms=lambda: 1700000000123,
        )
        result = await sink(EVENT)
        self.assertNotIn(secret, transport.calls[0]['body'].decode('utf-8'))
        self.assertNotIn(secret, json.dumps(result, sort_keys=True))
        self.assertNotIn(secret, repr(sink))

    def test_invalid_configuration_reports_names_not_secret_values(self):
        with self.assertRaises(ValueError) as caught:
            create_signed_v1_sink(
                endpoint='',
                source_id='',
                source_secret='super-secret-value',
            )
        message = str(caught.exception)
        self.assertNotIn('super-secret-value', message)
        self.assertRegex(message, r'endpoint|source_id')


if __name__ == '__main__':
    unittest.main()
