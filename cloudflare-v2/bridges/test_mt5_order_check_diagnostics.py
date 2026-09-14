import unittest
from types import SimpleNamespace

from mt5_bridge import MT5Engine


class OrderCheckNoneMT5:
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

    def symbol_info(self, symbol):
        return SimpleNamespace(
            name=symbol,
            visible=True,
            trade_exemode=2,
            filling_mode=3,
            volume_min=0.01,
            volume_max=100.0,
            volume_step=0.01,
        )

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(bid=1.3494, ask=1.3496)

    def symbol_select(self, _symbol, _enabled):
        return True

    def order_check(self, _request):
        return None

    def last_error(self):
        return (-8, 'AutoTrading disabled by client terminal')


class MT5OrderCheckDiagnosticsTests(unittest.TestCase):
    def test_order_check_none_surfaces_terminal_last_error(self):
        engine = MT5Engine(OrderCheckNoneMT5())

        with self.assertRaises(RuntimeError) as raised:
            engine.execute({
                'action': 'OPEN_POSITION',
                'symbol': 'GBPUSD',
                'side': 'BUY',
                'orderType': 'MARKET',
                'volume': 0.01,
            }, command_id='diagnostic-1')

        message = str(raised.exception)
        self.assertIn('order_check failed', message)
        self.assertIn('last_error=-8', message)
        self.assertIn('AutoTrading disabled by client terminal', message)


if __name__ == '__main__':
    unittest.main()
