import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from mt5_bridge import MT5Engine, command_marker


class ReconcilingFakeMT5:
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

    def __init__(self, *, deals=None, orders=None, positions=None, history_orders=None, record_send_as_deal=False):
        self.deals = list(deals or [])
        self.orders = list(orders or [])
        self.positions = list(positions or [])
        self.history_orders = list(history_orders or [])
        self.record_send_as_deal = record_send_as_deal
        self.sent = []
        self.checked = []
        self.history_deal_calls = []
        self.history_order_calls = []

    def symbol_info(self, symbol):
        return SimpleNamespace(name=symbol, visible=True)

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(bid=2525.9, ask=2526.1)

    def symbol_select(self, _symbol, _enabled):
        return True

    def order_check(self, request):
        self.checked.append(dict(request))
        return SimpleNamespace(retcode=0, comment='Done')

    def order_send(self, request):
        self.sent.append(dict(request))
        result = SimpleNamespace(
            retcode=self.TRADE_RETCODE_DONE,
            comment='Done',
            order=9001,
            deal=9002,
            price=2526.15,
        )
        if self.record_send_as_deal:
            self.deals.append(SimpleNamespace(
                ticket=9002,
                order=9001,
                position_id=7001,
                price=2526.15,
                comment=request.get('comment'),
                magic=request.get('magic'),
                time_msc=1770000000100,
            ))
        return result

    def orders_get(self, **_kwargs):
        return tuple(self.orders)

    def positions_get(self, ticket=None, **_kwargs):
        if ticket is not None:
            return tuple(item for item in self.positions if int(getattr(item, 'ticket', -1)) == int(ticket))
        return tuple(self.positions)

    def history_deals_get(self, start, end):
        self.history_deal_calls.append((start, end))
        return tuple(self.deals)

    def history_orders_get(self, start, end):
        self.history_order_calls.append((start, end))
        return tuple(self.history_orders)


def broker_record(*, command_id, position_id=7001, order=9001, deal=9002, magic=460051, comment=None):
    return SimpleNamespace(
        ticket=deal,
        order=order,
        position_id=position_id,
        price=2526.15,
        comment=comment if comment is not None else command_marker(command_id),
        magic=magic,
        time_msc=1770000000100,
    )


class MT5BridgeReconciliationTests(unittest.TestCase):
    def test_broker_position_status_reads_exact_open_protection_without_sending(self):
        class PositionStatusMT5:
            POSITION_TYPE_BUY = 0
            def __init__(self):
                self.sent = []
                self.queries = []
            def positions_get(self, ticket=None):
                self.queries.append(ticket)
                return (SimpleNamespace(ticket=700, symbol='EURUSD', type=0, volume=0.10, sl=1.1, tp=1.12, time=1770000000),)
            def order_send(self, request): self.sent.append(request)
        mt5 = PositionStatusMT5()
        snapshot = MT5Engine(mt5).broker_position_status('700')
        self.assertEqual(snapshot['positionId'], '700')
        self.assertTrue(snapshot['isOpen'])
        self.assertEqual(snapshot['side'], 'BUY')
        self.assertEqual(snapshot['stopLoss'], 1.1)
        self.assertEqual(snapshot['takeProfit'], 1.12)
        self.assertEqual(mt5.queries, [700])
        self.assertEqual(mt5.sent, [])

    def test_broker_position_close_status_reads_tp_reason_and_exact_position_without_sending(self):
        class PositionHistoryMT5:
            DEAL_ENTRY_IN = 0
            DEAL_ENTRY_OUT = 1
            DEAL_ENTRY_INOUT = 2
            DEAL_ENTRY_OUT_BY = 3
            DEAL_REASON_TP = 5

            def __init__(self):
                self.sent = []
                self.position_queries = []
                self.history_queries = []
                self.deals = (
                    SimpleNamespace(ticket=100, position_id=700, volume=1.0, entry=0, reason=0, price=1.1),
                    SimpleNamespace(ticket=101, position_id=700, volume=1.0, entry=1, reason=5, price=1.12),
                    SimpleNamespace(ticket=102, position_id=701, volume=2.0, entry=1, reason=5, price=1.12),
                )

            def positions_get(self, ticket=None):
                self.position_queries.append(ticket)
                return ()
            def history_deals_get(self, start, end, position=None):
                self.history_queries.append(position)
                return tuple(deal for deal in self.deals if deal.position_id == position)
            def order_send(self, request): self.sent.append(request)

        mt5 = PositionHistoryMT5()
        snapshot = MT5Engine(mt5).broker_position_close_status('700')
        self.assertEqual(snapshot['positionId'], '700')
        self.assertFalse(snapshot['isOpen'])
        self.assertEqual(snapshot['initialLots'], 1.0)
        self.assertEqual(snapshot['closedLots'], 1.0)
        self.assertEqual(snapshot['deals'], [{'dealId': '101', 'positionId': '700', 'lots': 1.0,
            'entry': 'OUT', 'reason': 'TP', 'executionPrice': 1.12}])
        self.assertEqual(mt5.position_queries, [700])
        self.assertEqual(mt5.history_queries, [700])
        self.assertEqual(mt5.sent, [])

    def test_active_pending_order_does_not_require_ticket_history_lookup(self):
        class ActiveOrderHistoryUnavailableMT5:
            ORDER_STATE_FILLED = 4
            ORDER_STATE_CANCELED = 2
            ORDER_STATE_EXPIRED = 5
            ORDER_STATE_REJECTED = 6

            def __init__(self):
                self.order = SimpleNamespace(ticket=902, time_setup=1770000000,
                    volume_initial=0.10, volume_current=0.10, state=1)
                self.ticket_history_calls = 0
                self.range_history_calls = 0

            def orders_get(self, ticket=None): return (self.order,) if ticket == 902 else ()
            def positions_get(self): return ()
            def history_orders_get(self, *args, ticket=None):
                if ticket is not None:
                    self.ticket_history_calls += 1
                    return None
                self.range_history_calls += 1
                return ()
            def history_deals_get(self, start, end, ticket=None): return ()
            def order_send(self, request): raise AssertionError('status reads must never send broker orders')

        mt5 = ActiveOrderHistoryUnavailableMT5()
        snapshot = MT5Engine(mt5).pending_order_status('902')

        self.assertEqual(snapshot['status'], 'PENDING')
        self.assertEqual(snapshot['brokerOrderId'], '902')
        self.assertEqual(mt5.ticket_history_calls, 0)
        self.assertEqual(mt5.range_history_calls, 0)

    def test_historical_order_uses_time_range_when_ticket_history_lookup_is_unavailable(self):
        class HistoricalOrderHistoryFallbackMT5:
            ORDER_STATE_FILLED = 4
            ORDER_STATE_CANCELED = 2
            ORDER_STATE_EXPIRED = 5
            ORDER_STATE_REJECTED = 6

            def __init__(self):
                self.setup_time = int((datetime.now(timezone.utc) - timedelta(days=6)).timestamp())
                self.historical = SimpleNamespace(ticket=903, time_setup=self.setup_time,
                    volume_initial=0.10, volume_current=0.0, state=2)
                self.unrelated = SimpleNamespace(ticket=904, time_setup=self.setup_time,
                    volume_initial=0.10, volume_current=0.0, state=4)
                self.range_calls = []

            def orders_get(self, ticket=None): return ()
            def positions_get(self): return ()
            def history_orders_get(self, *args, ticket=None):
                if ticket is not None: return None
                self.range_calls.append((args[0], args[1]))
                start, end = args
                return tuple(order for order in (self.historical, self.unrelated)
                    if start <= datetime.fromtimestamp(order.time_setup, tz=timezone.utc) <= end)
            def history_deals_get(self, start, end, ticket=None): return ()
            def order_send(self, request): raise AssertionError('status reads must never send broker orders')

        mt5 = HistoricalOrderHistoryFallbackMT5()
        snapshot = MT5Engine(mt5).pending_order_status('903')

        self.assertEqual(snapshot['status'], 'CANCELLED')
        self.assertEqual(snapshot['brokerOrderId'], '903')
        self.assertEqual(len(mt5.range_calls), 1)
        start, end = mt5.range_calls[0]
        order_time = datetime.fromtimestamp(mt5.setup_time, tz=timezone.utc)
        checked_at = datetime.now(timezone.utc)
        self.assertLessEqual(start, order_time)
        self.assertAlmostEqual((checked_at - start).total_seconds(), 7 * 24 * 60 * 60, delta=5)
        self.assertGreaterEqual(end, checked_at)
        self.assertLessEqual(end, checked_at + timedelta(seconds=10))

    def test_pending_order_status_is_exact_read_only_and_aggregates_position_deals(self):
        class StatusMT5:
            ORDER_STATE_FILLED = 4
            ORDER_STATE_CANCELED = 2
            ORDER_STATE_EXPIRED = 5
            ORDER_STATE_REJECTED = 6

            def __init__(self):
                self.sent = []
                self.order = SimpleNamespace(ticket=901, time_setup=1770000000, volume_initial=0.10, volume_current=0.04, state=1)
                self.deals = [
                    SimpleNamespace(order=901, ticket=1001, position_id=7001, volume=0.04, price=1.08),
                    SimpleNamespace(order=901, ticket=1002, position_id=7002, volume=0.02, price=1.09),
                    SimpleNamespace(order=999, ticket=1003, position_id=7003, volume=0.01, price=1.1),
                ]

            def orders_get(self, ticket=None): return (self.order,) if ticket == 901 else ()
            def positions_get(self): return (SimpleNamespace(ticket=7001),)
            def history_orders_get(self, ticket=None): return ()
            def history_deals_get(self, start, end, ticket=None): return tuple(d for d in self.deals if d.order == ticket)
            def order_send(self, request): self.sent.append(request)

        mt5 = StatusMT5()
        snapshot = MT5Engine(mt5).pending_order_status('901')
        self.assertEqual(snapshot['status'], 'PARTIALLY_FILLED')
        self.assertEqual(snapshot['remainingLots'], 0.04)
        self.assertEqual([(fill['positionId'], fill['lots']) for fill in snapshot['fills']], [('7001', 0.04), ('7002', 0.02)])
        self.assertEqual([fill['isOpen'] for fill in snapshot['fills']], [True, False])
        self.assertEqual(mt5.sent, [])

    def test_command_marker_is_deterministic_broker_safe_and_does_not_truncate_common_prefixes(self):
        first_id = 'workspace:very-long-common-prefix:destination:account:leg:one'
        second_id = 'workspace:very-long-common-prefix:destination:account:leg:two'
        first = command_marker(first_id)
        self.assertEqual(first, command_marker(first_id))
        self.assertNotEqual(first, command_marker(second_id))
        self.assertLessEqual(len(first), 20)
        self.assertTrue(first.isascii())
        self.assertTrue(first.isalnum())
        self.assertTrue(first.startswith('mkety'))
        self.assertNotIn(first_id, first)

    def test_exact_marker_and_magic_history_deal_recovers_without_order_send(self):
        command_id = 'open-crash-1'
        mt5 = ReconcilingFakeMT5(deals=[broker_record(command_id=command_id)])
        engine = MT5Engine(mt5)
        result = engine.execute_reconciled({
            'action': 'OPEN_POSITION', 'symbol': 'XAUUSD.a', 'side': 'BUY',
            'orderType': 'MARKET', 'volume': 0.01,
        }, command_id)

        self.assertTrue(result['ok'])
        self.assertTrue(result['recovered'])
        self.assertEqual(result['position_id'], 7001)
        self.assertEqual(result['order_id'], 9001)
        self.assertEqual(result['deal_id'], 9002)
        self.assertEqual(mt5.sent, [])

    def test_symbol_volume_similarity_never_counts_without_exact_marker_and_magic(self):
        command_id = 'open-fresh-1'
        lookalike = broker_record(command_id='different-command', magic=460051)
        wrong_magic = broker_record(command_id=command_id, magic=999)
        mt5 = ReconcilingFakeMT5(deals=[lookalike, wrong_magic])
        engine = MT5Engine(mt5)
        result = engine.execute_reconciled({
            'action': 'OPEN_POSITION', 'symbol': 'XAUUSD.a', 'side': 'BUY',
            'orderType': 'MARKET', 'volume': 0.01,
        }, command_id)

        self.assertTrue(result['ok'])
        self.assertFalse(result.get('recovered', False))
        self.assertEqual(len(mt5.sent), 1)
        self.assertEqual(mt5.sent[0]['comment'], command_marker(command_id))

    def test_conflicting_exact_marker_records_fail_closed_before_order_send(self):
        command_id = 'open-ambiguous-1'
        mt5 = ReconcilingFakeMT5(deals=[
            broker_record(command_id=command_id, position_id=7001, deal=9002),
            broker_record(command_id=command_id, position_id=7002, deal=9003),
        ])
        engine = MT5Engine(mt5)

        with self.assertRaisesRegex(RuntimeError, 'MT5_RECONCILIATION_AMBIGUOUS'):
            engine.execute_reconciled({
                'action': 'OPEN_POSITION', 'symbol': 'XAUUSD.a', 'side': 'BUY',
                'orderType': 'MARKET', 'volume': 0.01,
            }, command_id)
        self.assertEqual(mt5.sent, [])

    def test_crash_after_broker_acceptance_before_ledger_write_replays_as_one_broker_action(self):
        command_id = 'open-crash-window'
        mt5 = ReconcilingFakeMT5(record_send_as_deal=True)
        engine = MT5Engine(mt5)
        command = {
            'action': 'OPEN_POSITION', 'symbol': 'XAUUSD.a', 'side': 'BUY',
            'orderType': 'MARKET', 'volume': 0.01,
        }

        first = engine.execute_reconciled(command, command_id)
        self.assertTrue(first['ok'])
        self.assertEqual(len(mt5.sent), 1)

        # Simulates a process crash here: the broker accepted the first request,
        # but the local ReplayLedger was never written. The same command arrives again.
        second = engine.execute_reconciled(command, command_id)
        self.assertTrue(second['ok'])
        self.assertTrue(second['recovered'])
        self.assertEqual(second['deal_id'], 9002)
        self.assertEqual(len(mt5.sent), 1)


if __name__ == '__main__':
    unittest.main()
