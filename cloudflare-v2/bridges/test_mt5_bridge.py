import json
import tempfile
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from mt5_bridge import MT5Engine, ReplayLedger
from mt5_source_capture import MT5SourceCapture


class FakeMT5:
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_PENDING = 5
    TRADE_ACTION_SLTP = 6
    TRADE_ACTION_REMOVE = 8
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    ORDER_TYPE_BUY_LIMIT = 2
    ORDER_TYPE_SELL_LIMIT = 3
    ORDER_TYPE_BUY_STOP = 4
    ORDER_TYPE_SELL_STOP = 5
    ORDER_TIME_GTC = 0
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_RETURN = 2
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_PLACED = 10008
    TRADE_RETCODE_DONE_PARTIAL = 10010

    def __init__(self):
        self.sent = []
        self.checked = []

    def symbol_info(self, symbol):
        return SimpleNamespace(name=symbol, visible=True, trade_exemode=2, filling_mode=3, volume_min=0.01, volume_max=100.0, volume_step=0.01)

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(bid=2525.9, ask=2526.1)

    def symbol_select(self, _symbol, _enabled):
        return True

    def order_check(self, request):
        self.checked.append(dict(request))
        return SimpleNamespace(retcode=0, comment='Done')

    def order_send(self, request):
        self.sent.append(dict(request))
        return SimpleNamespace(retcode=self.TRADE_RETCODE_DONE, comment='Done', order=9001, deal=9002, price=2526.15, _asdict=lambda: {'retcode': self.TRADE_RETCODE_DONE, 'order': 9001, 'deal': 9002, 'price': 2526.15, 'comment': 'Done'})

    def positions_get(self, ticket=None, symbol=None):
        if ticket is not None:
            return (SimpleNamespace(ticket=ticket, symbol='XAUUSD.a', volume=0.03, type=self.ORDER_TYPE_BUY),)
        return ()


class FakeMT5Source:
    def __init__(self, login=42, deals=None):
        self.login = login
        self.deals = list(deals or [])
        self.history_calls = []

    def account_info(self):
        return SimpleNamespace(login=self.login)

    def history_deals_get(self, start, end):
        self.history_calls.append((start, end))
        return tuple(self.deals)


def source_deal(ticket, time_msc, symbol='XAUUSD.a', order=7001, position_id=5001):
    return SimpleNamespace(
        ticket=ticket,
        order=order,
        position_id=position_id,
        time_msc=time_msc,
        type=0,
        entry=0,
        symbol=symbol,
        volume=0.01,
        price=2526.15,
        commission=-0.2,
        swap=0.0,
        profit=1.5,
        fee=0.0,
        reason=3,
    )


class MT5BridgeTests(unittest.TestCase):
    def test_market_open_uses_ask_for_buy_and_checks_before_send(self):
        mt5 = FakeMT5()
        engine = MT5Engine(mt5)
        result = engine.execute({
            'action': 'OPEN_POSITION', 'symbol': 'XAUUSD.a', 'side': 'BUY', 'orderType': 'MARKET',
            'volume': 0.03, 'stopLoss': 2518, 'takeProfit': 2535,
        }, command_id='cmd-1')
        self.assertTrue(result['ok'])
        self.assertEqual(mt5.checked[0]['price'], 2526.1)
        self.assertEqual(mt5.sent[0]['sl'], 2518)
        self.assertEqual(mt5.sent[0]['tp'], 2535)
        self.assertEqual(result['fill_price'], 2526.15)

    def test_partial_close_uses_opposite_side_and_requested_volume(self):
        mt5 = FakeMT5()
        engine = MT5Engine(mt5)
        result = engine.execute({'action': 'CLOSE_PARTIAL', 'positionId': '9001', 'volume': 0.01}, command_id='close-1')
        self.assertTrue(result['ok'])
        request = mt5.sent[0]
        self.assertEqual(request['type'], mt5.ORDER_TYPE_SELL)
        self.assertEqual(request['volume'], 0.01)
        self.assertEqual(request['position'], 9001)

    def test_replay_ledger_returns_stored_result_without_second_execution(self):
        with tempfile.NamedTemporaryFile(suffix='.sqlite') as tmp:
            ledger = ReplayLedger(tmp.name)
            stored = {'ok': True, 'position_id': 77}
            self.assertIsNone(ledger.get('same-command'))
            ledger.put('same-command', stored)
            self.assertEqual(ledger.get('same-command'), stored)


class MT5SourceCaptureTests(unittest.TestCase):
    def test_poll_emits_sorted_exact_account_deals_with_stable_native_identity(self):
        deals = [source_deal(2, 1770000000200), source_deal(1, 1770000000100)]
        mt5 = FakeMT5Source(login=42, deals=deals)
        delivered = []
        capture = MT5SourceCapture(mt5=mt5, deliver=delivered.append, account_id=42, lookback_ms=5000, overlap_ms=1000)

        result = capture.poll_once(now_ms=1770000005000)

        self.assertEqual(result['delivered'], 2)
        self.assertEqual([item['nativeEventId'] for item in delivered], ['1', '2'])
        self.assertEqual(delivered[0]['providerType'], 'mt5_source_bridge')
        self.assertEqual(delivered[0]['occurredAt'], datetime.fromtimestamp(1770000000100 / 1000, tz=timezone.utc).isoformat())
        self.assertEqual(delivered[0]['metadata'], {'native_kind': 'deal'})
        self.assertEqual(delivered[0]['structuredPayload']['ticket'], 1)
        self.assertEqual(delivered[0]['structuredPayload']['symbol'], 'XAUUSD.a')
        self.assertNotIn('account_id', delivered[0])
        self.assertNotIn('accountId', delivered[0])

    def test_exact_account_mismatch_fails_closed_before_history_or_delivery(self):
        mt5 = FakeMT5Source(login=99, deals=[source_deal(1, 1770000000100)])
        delivered = []
        capture = MT5SourceCapture(mt5=mt5, deliver=delivered.append, account_id=42)

        with self.assertRaisesRegex(RuntimeError, 'MT5_SOURCE_ACCOUNT_MISMATCH'):
            capture.poll_once(now_ms=1770000005000)

        self.assertEqual(mt5.history_calls, [])
        self.assertEqual(delivered, [])

    def test_overlapping_poll_window_does_not_redeliver_seen_deal_in_same_capture(self):
        mt5 = FakeMT5Source(login=42, deals=[source_deal(10, 1770000009000)])
        delivered = []
        capture = MT5SourceCapture(mt5=mt5, deliver=delivered.append, account_id=42, lookback_ms=5000, overlap_ms=2000)

        capture.poll_once(now_ms=1770000010000)
        capture.poll_once(now_ms=1770000011000)

        self.assertEqual([item['nativeEventId'] for item in delivered], ['10'])
        first_start, first_end = mt5.history_calls[0]
        second_start, second_end = mt5.history_calls[1]
        self.assertEqual(first_start, datetime.fromtimestamp(1770000005000 / 1000, tz=timezone.utc))
        self.assertEqual(first_end, datetime.fromtimestamp(1770000010000 / 1000, tz=timezone.utc))
        self.assertEqual(second_start, datetime.fromtimestamp(1770000008000 / 1000, tz=timezone.utc))
        self.assertEqual(second_end, datetime.fromtimestamp(1770000011000 / 1000, tz=timezone.utc))

    def test_malformed_deal_is_ignored_and_one_delivery_failure_does_not_stop_next_deal(self):
        malformed = SimpleNamespace(ticket=None, time_msc=1770000000000)
        mt5 = FakeMT5Source(login=42, deals=[malformed, source_deal(1, 1770000000100), source_deal(2, 1770000000200)])
        attempted = []

        def deliver(event):
            attempted.append(event['nativeEventId'])
            if event['nativeEventId'] == '1':
                raise RuntimeError('source-local delivery failed')

        capture = MT5SourceCapture(mt5=mt5, deliver=deliver, account_id=42)
        result = capture.poll_once(now_ms=1770000005000)

        self.assertEqual(attempted, ['1', '2'])
        self.assertEqual(result['ignored'], 1)
        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['delivered'], 1)
        self.assertEqual(capture.status()['failedEvents'], 1)
        self.assertEqual(capture.status()['deliveredEvents'], 1)
        self.assertEqual(capture.status()['status'], 'healthy')

    def test_two_capture_instances_keep_seen_state_health_and_failures_independent(self):
        mt5_a = FakeMT5Source(login=42, deals=[source_deal(1, 1770000000100)])
        mt5_b = FakeMT5Source(login=99, deals=[source_deal(1, 1770000000100)])
        b_delivered = []

        def fail_a(_event):
            raise RuntimeError('A failed')

        a = MT5SourceCapture(mt5=mt5_a, deliver=fail_a, account_id=42)
        b = MT5SourceCapture(mt5=mt5_b, deliver=b_delivered.append, account_id=99)

        a.poll_once(now_ms=1770000005000)
        b.poll_once(now_ms=1770000005000)

        self.assertEqual(a.status()['failedEvents'], 1)
        self.assertEqual(a.status()['deliveredEvents'], 0)
        self.assertEqual(b.status()['failedEvents'], 0)
        self.assertEqual(b.status()['deliveredEvents'], 1)
        self.assertEqual([event['nativeEventId'] for event in b_delivered], ['1'])

    def test_status_is_sanitized_and_does_not_expose_account_or_transport_credentials(self):
        capture = MT5SourceCapture(mt5=FakeMT5Source(login=42), deliver=lambda _event: None, account_id=42)
        capture.poll_once(now_ms=1770000005000)
        serialized = json.dumps(capture.status()).lower()

        for forbidden in ('secret', 'token', 'password', 'credential', 'accountid', 'account_id', 'login'):
            self.assertNotIn(forbidden, serialized)


if __name__ == '__main__':
    unittest.main()
