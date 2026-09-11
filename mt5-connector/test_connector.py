import importlib.util
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

MODULE_PATH = Path(__file__).with_name('mkety_mt5_connector.py')
spec = importlib.util.spec_from_file_location('mkety_mt5_connector', MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeResult:
    retcode = 10009
    order = 501
    deal = 601
    price = 2500.5
    comment = 'ok'


class FakeMT5:
    ACCOUNT_TRADE_MODE_REAL = 2
    SYMBOL_TRADE_MODE_DISABLED = 0
    ORDER_FILLING_RETURN = 2
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_FOK = 0
    ORDER_TIME_GTC = 0
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
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_PLACED = 10008
    TRADE_RETCODE_DONE_PARTIAL = 10010

    def account_info(self):
        return SimpleNamespace(
            login=123456, server='Broker-Demo', company='Broker Ltd', trade_mode=0,
            balance=10000.0, equity=9950.0, margin_free=9000.0, currency='USD', leverage=500,
        )

    def _symbol(self, name):
        rows = {
            'XAUUSD.r': SimpleNamespace(
                name='XAUUSD.r', description='Gold', trade_mode=4, volume_min=0.01, volume_max=100,
                volume_step=0.01, trade_tick_size=0.01, point=0.01, trade_tick_value=1,
                trade_tick_value_loss=1.2, trade_tick_value_profit=0.9, trade_contract_size=100,
                digits=2, currency_base='XAU', currency_profit='USD', currency_margin='USD', visible=True,
            ),
            'Synthetic 75': SimpleNamespace(
                name='Synthetic 75', description='Derived market', trade_mode=4, volume_min=0.001, volume_max=10,
                volume_step=0.001, trade_tick_size=0.01, point=0.01, trade_tick_value=0.5,
                trade_tick_value_loss=0.5, trade_tick_value_profit=0.5, trade_contract_size=1,
                digits=2, currency_base='', currency_profit='USD', currency_margin='USD', visible=True,
            ),
        }
        return rows.get(name)

    def symbols_get(self):
        return (self._symbol('XAUUSD.r'), self._symbol('Synthetic 75'))

    def symbol_info(self, name):
        return self._symbol(name)

    def symbol_select(self, name, enabled):
        return True

    def symbol_info_tick(self, name):
        return SimpleNamespace(ask=2500.5, bid=2500.4, last=2500.45)

    def order_check(self, request):
        return SimpleNamespace(retcode=0, comment='ok')

    def order_send(self, request):
        return FakeResult()

    def positions_get(self, **kwargs):
        return ()

    def orders_get(self):
        return ()

    def history_orders_get(self, start, end):
        return ()

    def history_deals_get(self, start, end):
        return ()


class ConnectorTests(unittest.TestCase):
    def test_terminal_identity_and_catalog_come_from_terminal_not_env(self):
        mt5 = FakeMT5()
        identity = module.terminal_identity(mt5)
        self.assertEqual(identity['accountNumber'], '123456')
        self.assertEqual(identity['serverName'], 'Broker-Demo')
        catalog = module.symbol_catalog(mt5)
        self.assertEqual([row['platformSymbol'] for row in catalog], ['XAUUSD.r', 'Synthetic 75'])
        self.assertEqual(catalog[0]['tickValueLoss'], 1.2)
        self.assertEqual(catalog[0]['contractSize'], 100.0)
        self.assertNotIn('password', catalog[0])

    def test_live_terminal_context_preserves_risk_economics_and_tick_without_credentials(self):
        context = module.terminal_context(FakeMT5(), 'XAUUSD.r')
        self.assertEqual(context['account']['accountNumber'], '123456')
        self.assertEqual(context['account']['balance'], 10000.0)
        self.assertEqual(context['account']['equity'], 9950.0)
        self.assertEqual(context['symbol']['platformSymbol'], 'XAUUSD.r')
        self.assertEqual(context['symbol']['tickValueLoss'], 1.2)
        self.assertEqual(context['symbol']['minLots'], 0.01)
        self.assertEqual(context['symbol']['stepLots'], 0.01)
        self.assertEqual(context['tick']['ask'], 2500.5)
        self.assertEqual(context['tick']['bid'], 2500.4)
        self.assertNotIn('password', json.dumps(context).lower())

    def test_pairing_config_is_local_file_not_customer_environment(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'connector.json'
            saved = module.save_local_config(path, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'mt5v1.test.token',
                'connector_instance_id': 'instance-1',
            })
            loaded = module.load_local_config(path)
            self.assertEqual(saved, loaded)
            self.assertEqual(loaded['connection_token'], 'mt5v1.test.token')
            self.assertNotIn('account_id', loaded)
            self.assertNotIn('server', loaded)

    def test_successful_pairing_replaces_local_pair_token_with_gateway_reconnect_token(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'connector.json'
            module.save_local_config(path, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'mt5v1.pair.signature',
                'connector_instance_id': 'instance-1',
            })
            connector = module.MketyMt5Connector(FakeMT5(), lambda *args, **kwargs: None, module.load_local_config(path),
                                                  ledger_path=Path(td) / 'ledger.sqlite', config_path=path)
            connector.handle_auth_ok({'type': 'auth_ok', 'accountRowId': 'row-1', 'reconnectToken': 'mt5r1.reconnect.signature'})
            loaded = module.load_local_config(path)
            self.assertEqual(loaded['connection_token'], 'mt5r1.reconnect.signature')
            self.assertEqual(connector.config['connection_token'], 'mt5r1.reconnect.signature')
            self.assertNotIn('mt5v1.pair.signature', path.read_text(encoding='utf-8'))

    def test_reconnect_auth_without_rotation_keeps_existing_local_credential(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'connector.json'
            module.save_local_config(path, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'mt5r1.reconnect.signature',
                'connector_instance_id': 'instance-1',
            })
            connector = module.MketyMt5Connector(FakeMT5(), lambda *args, **kwargs: None, module.load_local_config(path),
                                                  ledger_path=Path(td) / 'ledger.sqlite', config_path=path)
            connector.handle_auth_ok({'type': 'auth_ok', 'accountRowId': 'row-1'})
            self.assertEqual(module.load_local_config(path)['connection_token'], 'mt5r1.reconnect.signature')

    def test_maintenance_emits_heartbeat_and_refreshes_actual_terminal_catalog_on_independent_cadences(self):
        connector = module.MketyMt5Connector(FakeMT5(), lambda *args, **kwargs: None, {
            'gateway_url': module.DEFAULT_GATEWAY,
            'connection_token': 'token',
            'connector_instance_id': 'i',
        }, ledger_path=':memory:', heartbeat_seconds=20, symbol_refresh_seconds=900)
        messages, state = connector.maintenance_messages(now=1000, last_heartbeat=970, last_symbols=0)
        self.assertEqual([item['type'] for item in messages], ['heartbeat', 'symbols'])
        self.assertEqual(messages[1]['symbols'][0]['platformSymbol'], 'XAUUSD.r')
        self.assertEqual(state, {'last_heartbeat': 1000, 'last_symbols': 1000})

        quiet, state2 = connector.maintenance_messages(now=1010, **state)
        self.assertEqual(quiet, [])
        self.assertEqual(state2, state)

        heartbeat_only, state3 = connector.maintenance_messages(now=1021, **state)
        self.assertEqual([item['type'] for item in heartbeat_only], ['heartbeat'])
        self.assertEqual(state3['last_symbols'], 1000)

    def test_envelope_rejects_wrong_broker_account_before_engine(self):
        with tempfile.TemporaryDirectory() as td:
            connector = module.MketyMt5Connector(FakeMT5(), lambda *args, **kwargs: None, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'token',
                'connector_instance_id': 'i',
            }, ledger_path=Path(td) / 'ledger.sqlite')
            response = connector.execute_envelope({
                'command_id': 'cmd-1', 'broker_account_id': '999', 'expires_at': int(time.time() * 1000) + 10000,
                'command': {'action': 'OPEN_POSITION'},
            })
            self.assertFalse(response['ok'])
            self.assertEqual(response['reason'], 'MT5_BROKER_ACCOUNT_MISMATCH')

    def test_connector_executes_existing_mt5_engine_and_replays_duplicate(self):
        with tempfile.TemporaryDirectory() as td:
            connector = module.MketyMt5Connector(FakeMT5(), lambda *args, **kwargs: None, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'token',
                'connector_instance_id': 'i',
            }, ledger_path=Path(td) / 'ledger.sqlite')
            envelope = {
                'command_id': 'cmd-2', 'broker_account_id': '123456', 'expires_at': int(time.time() * 1000) + 10000,
                'command': {'action': 'OPEN_POSITION', 'symbol': 'XAUUSD.r', 'side': 'BUY', 'orderType': 'MARKET', 'volume': 0.01},
            }
            first = connector.execute_envelope(envelope)
            second = connector.execute_envelope(envelope)
            self.assertTrue(first['ok'])
            self.assertEqual(first['orderId'], 501)
            self.assertTrue(second['duplicate'])

    def test_context_request_returns_fresh_terminal_context(self):
        with tempfile.TemporaryDirectory() as td:
            connector = module.MketyMt5Connector(FakeMT5(), lambda *args, **kwargs: None, {
                'gateway_url': module.DEFAULT_GATEWAY,
                'connection_token': 'token',
                'connector_instance_id': 'i',
            }, ledger_path=Path(td) / 'ledger.sqlite')
            response = connector.handle_message({'type': 'context_request', 'requestId': 'ctx-1', 'symbol': 'XAUUSD.r'})
            self.assertEqual(response['type'], 'context_result')
            self.assertEqual(response['requestId'], 'ctx-1')
            self.assertTrue(response['ok'])
            self.assertEqual(response['context']['account']['equity'], 9950.0)
            self.assertEqual(response['context']['symbol']['tickValueLoss'], 1.2)


if __name__ == '__main__':
    unittest.main()
