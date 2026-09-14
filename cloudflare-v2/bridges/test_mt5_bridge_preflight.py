import unittest
from types import SimpleNamespace

from mt5_bridge import MT5Engine


class _BaseMT5:
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
        self.checked = []
        self.sent = []

    def symbol_info(self, symbol):
        return SimpleNamespace(
            name=symbol, visible=True, trade_exemode=2, filling_mode=3,
            volume_min=0.01, volume_max=100.0, volume_step=0.01,
        )

    def symbol_info_tick(self, _symbol):
        return SimpleNamespace(bid=1.1000, ask=1.1002)

    def symbol_select(self, _symbol, _enabled):
        return True

    def order_send(self, request):
        self.sent.append(dict(request))
        return SimpleNamespace(
            retcode=self.TRADE_RETCODE_DONE, comment='Done', order=10, deal=11, price=request.get('price', 0),
        )


class SuccessfulMT5(_BaseMT5):
    def order_check(self, request):
        self.checked.append(dict(request))
        return SimpleNamespace(retcode=0, comment='Done')

    def last_error(self):
        return (1, 'Success')


class NoneCheckMT5(_BaseMT5):
    def order_check(self, request):
        self.checked.append(dict(request))
        return None

    def last_error(self):
        return (-2, 'Invalid arguments')


class MT5PreflightRegressionTests(unittest.TestCase):
    def test_market_deal_does_not_send_pending_only_time_in_force_field(self):
        mt5 = SuccessfulMT5()
        result = MT5Engine(mt5).execute({
            'action': 'OPEN_POSITION', 'symbol': 'GBPUSD', 'side': 'BUY',
            'orderType': 'MARKET', 'volume': 0.01,
        }, command_id='market-1')
        self.assertTrue(result['ok'])
        self.assertNotIn('type_time', mt5.checked[0])
        self.assertNotIn('type_time', mt5.sent[0])

    def test_none_order_check_surfaces_terminal_last_error_for_exact_diagnosis(self):
        mt5 = NoneCheckMT5()
        with self.assertRaisesRegex(RuntimeError, r'order_check failed:.*last_error=-2 Invalid arguments'):
            MT5Engine(mt5).execute({
                'action': 'OPEN_POSITION', 'symbol': 'GBPUSD', 'side': 'BUY',
                'orderType': 'MARKET', 'volume': 0.01,
            }, command_id='market-none')


if __name__ == '__main__':
    unittest.main()
