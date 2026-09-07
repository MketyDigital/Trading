import hashlib
import hmac
import unittest

from mt5_bridge import verify_metadata_request


class MT5MetadataAuthTests(unittest.TestCase):
    def test_accepts_exact_signed_metadata_request(self):
        secret = 'bridge-secret'
        timestamp = '1700000000000'
        target = '/v1/account'
        payload = f'GET\n{target}\n{timestamp}'.encode('utf-8')
        signature = 'v1=' + hmac.new(secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()

        self.assertTrue(verify_metadata_request(
            secret=secret,
            method='GET',
            target=target,
            timestamp=timestamp,
            signature=signature,
            now_ms=1700000000000,
            max_skew_ms=30000,
        ))

    def test_rejects_missing_bad_or_stale_metadata_auth(self):
        secret = 'bridge-secret'
        target = '/v1/symbols'
        timestamp = '1700000000000'
        payload = f'GET\n{target}\n{timestamp}'.encode('utf-8')
        valid = 'v1=' + hmac.new(secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()

        cases = [
            {'timestamp': '', 'signature': valid, 'now_ms': 1700000000000},
            {'timestamp': timestamp, 'signature': '', 'now_ms': 1700000000000},
            {'timestamp': timestamp, 'signature': 'v1=' + ('0' * 64), 'now_ms': 1700000000000},
            {'timestamp': timestamp, 'signature': valid, 'now_ms': 1700000040001},
            {'timestamp': timestamp, 'signature': valid, 'now_ms': 1699999959999},
        ]
        for case in cases:
            with self.subTest(case=case):
                self.assertFalse(verify_metadata_request(
                    secret=secret,
                    method='GET',
                    target=target,
                    timestamp=case['timestamp'],
                    signature=case['signature'],
                    now_ms=case['now_ms'],
                    max_skew_ms=30000,
                ))


if __name__ == '__main__':
    unittest.main()
