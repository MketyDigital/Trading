import json
import tempfile
import unittest
from types import SimpleNamespace

from mt5_bridge import MT5Engine, ReplayLedger


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


if __name__ == '__main__':
    unittest.main()
