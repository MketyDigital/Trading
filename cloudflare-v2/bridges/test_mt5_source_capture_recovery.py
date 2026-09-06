import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from mt5_source_capture import MT5SourceCapture


class WindowedMT5:
    def __init__(self, login, deals):
        self.login = login
        self.deals = list(deals)
        self.history_calls = []

    def account_info(self):
        return SimpleNamespace(login=self.login)

    def history_deals_get(self, start, end):
        self.history_calls.append((start, end))
        start_ms = int(start.timestamp() * 1000)
        end_ms = int(end.timestamp() * 1000)
        return tuple(
            deal for deal in self.deals
            if start_ms <= int(deal.time_msc) <= end_ms
        )


def source_deal(ticket, time_msc):
    return SimpleNamespace(
        ticket=ticket,
        order=7001,
        position_id=5001,
        time_msc=time_msc,
        type=0,
        entry=0,
        symbol='XAUUSD.a',
        volume=0.01,
        price=2526.15,
        commission=0.0,
        swap=0.0,
        profit=0.0,
        fee=0.0,
        reason=3,
    )


class MT5SourceCaptureRecoveryTests(unittest.TestCase):
    def test_failed_delivery_pins_poll_cursor_until_event_is_successfully_redelivered(self):
        failed_event_ms = 1_770_000_001_000
        mt5 = WindowedMT5(42, [source_deal(9001, failed_event_ms)])
        attempts = []

        def deliver(event):
            attempts.append(event['nativeEventId'])
            if len(attempts) == 1:
                raise RuntimeError('temporary downstream outage')

        capture = MT5SourceCapture(
            mt5=mt5,
            deliver=deliver,
            account_id=42,
            lookback_ms=5_000,
            overlap_ms=1_000,
        )

        first = capture.poll_once(now_ms=1_770_000_005_000)
        second = capture.poll_once(now_ms=1_770_000_010_000)

        self.assertEqual(first['failed'], 1)
        self.assertEqual(second['delivered'], 1)
        self.assertEqual(attempts, ['9001', '9001'])
        self.assertEqual(capture.status()['deliveredEvents'], 1)

        second_start, _second_end = mt5.history_calls[1]
        self.assertLessEqual(
            second_start,
            datetime.fromtimestamp(failed_event_ms / 1000, tz=timezone.utc),
        )


if __name__ == '__main__':
    unittest.main()
