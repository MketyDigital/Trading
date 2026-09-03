import unittest
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
    def test_command_marker_is_deterministic_bounded_and_does_not_truncate_common_prefixes(self):
        first_id = 'workspace:very-long-common-prefix:destination:account:leg:one'
        second_id = 'workspace:very-long-common-prefix:destination:account:leg:two'
        first = command_marker(first_id)
        self.assertEqual(first, command_marker(first_id))
        self.assertNotEqual(first, command_marker(second_id))
        self.assertLessEqual(len(first), 31)
        self.assertTrue(first.startswith('mkety:'))
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
