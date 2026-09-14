import unittest
from types import SimpleNamespace

from mt5_bridge import MT5Engine, command_marker


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
    SYMBOL_TRADE_EXECUTION_MARKET = 2
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_PLACED = 10008
    TRADE_RETCODE_DONE_PARTIAL = 10010

    def __init__(self):
        self.checked = []
        self.sent = []

    def symbol_info(self, symbol):
        if symbol != 'GBPUSD':
            return None
        return SimpleNamespace(
            name=symbol, visible=True, trade_exemode=2, filling_mode=3,
            volume_min=0.01, volume_max=100.0, volume_step=0.01,
            digits=5, trade_tick_size=0.00001, point=0.00001,
            trade_stops_level=0, trade_freeze_level=0,
        )

    def symbols_get(self):
        info = self.symbol_info('GBPUSD')
        return (info,) if info else ()

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


class CommentRejectingMT5(SuccessfulMT5):
    def order_check(self, request):
        self.checked.append(dict(request))
        if request.get('comment'):
            return None
        return SimpleNamespace(retcode=0, comment='Done')

    def last_error(self):
        return (-2, 'Invalid "comment" argument')


class SuffixedSymbolMT5(SuccessfulMT5):
    def symbol_info(self, symbol):
        if symbol != 'XAUUSD.r':
            return None
        return SimpleNamespace(
            name='XAUUSD.r', visible=True, trade_exemode=2, filling_mode=3,
            volume_min=0.01, volume_max=100.0, volume_step=0.01,
            digits=2, trade_tick_size=0.01, point=0.01,
            trade_stops_level=0, trade_freeze_level=0,
        )

    def symbols_get(self):
        return (self.symbol_info('XAUUSD.r'),)

    def symbol_info_tick(self, symbol):
        if symbol != 'XAUUSD.r':
            return None
        return SimpleNamespace(bid=2500.40, ask=2500.50)


class NormalizingMT5(SuccessfulMT5):
    def symbol_info(self, symbol):
        if symbol != 'XAUUSD':
            return None
        return SimpleNamespace(
            name='XAUUSD', visible=True, trade_exemode=2, filling_mode=3,
            volume_min=0.10, volume_max=5.0, volume_step=0.10,
            digits=2, trade_tick_size=0.05, point=0.01,
            trade_stops_level=0, trade_freeze_level=0,
        )

    def symbols_get(self):
        return (self.symbol_info('XAUUSD'),)

    def symbol_info_tick(self, symbol):
        return SimpleNamespace(bid=2500.40, ask=2500.50)


class MT5PreflightRegressionTests(unittest.TestCase):
    def test_command_marker_is_short_ascii_alphanumeric_for_broker_compatibility(self):
        marker = command_marker('very-long-command-id:with:punctuation:and:broker:scope')
        self.assertLessEqual(len(marker), 20)
        self.assertTrue(marker.isascii())
        self.assertTrue(marker.isalnum())
        self.assertTrue(marker.startswith('mkety'))

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

    def test_comment_rejection_retries_same_broker_request_without_optional_comment(self):
        mt5 = CommentRejectingMT5()
        result = MT5Engine(mt5).execute({
            'action': 'OPEN_POSITION', 'symbol': 'GBPUSD', 'side': 'BUY',
            'orderType': 'MARKET', 'volume': 0.01,
        }, command_id='comment-retry')
        self.assertTrue(result['ok'])
        self.assertGreaterEqual(len(mt5.checked), 2)
        self.assertIn('comment', mt5.checked[0])
        self.assertNotIn('comment', mt5.checked[-1])
        self.assertNotIn('comment', mt5.sent[-1])

    def test_resolves_unique_broker_suffix_symbol_from_terminal_catalog(self):
        mt5 = SuffixedSymbolMT5()
        result = MT5Engine(mt5).execute({
            'action': 'OPEN_POSITION', 'symbol': 'XAUUSD', 'side': 'BUY',
            'orderType': 'MARKET', 'volume': 0.01,
        }, command_id='suffix-symbol')
        self.assertTrue(result['ok'])
        self.assertEqual(mt5.sent[-1]['symbol'], 'XAUUSD.r')

    def test_normalizes_volume_and_prices_to_broker_symbol_capabilities(self):
        mt5 = NormalizingMT5()
        result = MT5Engine(mt5).execute({
            'action': 'OPEN_POSITION', 'symbol': 'XAUUSD', 'side': 'BUY',
            'orderType': 'LIMIT', 'volume': 0.26, 'entryPrice': 2499.973,
            'stopLoss': 2490.027, 'takeProfit': 2510.026,
        }, command_id='normalize-request')
        self.assertTrue(result['ok'])
        request = mt5.sent[-1]
        self.assertEqual(request['volume'], 0.2)
        self.assertEqual(request['price'], 2499.95)
        self.assertEqual(request['sl'], 2490.05)
        self.assertEqual(request['tp'], 2510.05)


if __name__ == '__main__':
    unittest.main()
