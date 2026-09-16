import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('mkety_mt5_connector.py')
spec = importlib.util.spec_from_file_location('mkety_mt5_connector_multi_instance', MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeMt5:
    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    def initialize(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self.ok

    def last_error(self):
        return ('fake', 1)


class MultiInstanceTests(unittest.TestCase):
    def test_explicit_terminal_path_is_forwarded_to_mt5_initialize(self):
        mt5 = FakeMt5()
        module.initialize_terminal(mt5, r'C:\MT5\Octa\terminal64.exe')
        self.assertEqual(mt5.calls, [((), {'path': r'C:\MT5\Octa\terminal64.exe'})])

    def test_omitted_terminal_path_preserves_historical_auto_discovery(self):
        mt5 = FakeMt5()
        module.initialize_terminal(mt5)
        self.assertEqual(mt5.calls, [((), {})])

    def test_initialization_failure_remains_fail_closed(self):
        mt5 = FakeMt5(ok=False)
        with self.assertRaisesRegex(RuntimeError, 'MT5 initialize failed'):
            module.initialize_terminal(mt5, r'C:\MT5\Missing\terminal64.exe')

    def test_cli_accepts_terminal_and_ledger_paths(self):
        args = module.parse_args([
            '--terminal', r'C:\MT5\Deriv\terminal64.exe',
            '--config', r'C:\Mkety\Deriv\connector.json',
            '--ledger', r'C:\Mkety\Deriv\ledger.sqlite',
        ])
        self.assertEqual(args.terminal, r'C:\MT5\Deriv\terminal64.exe')
        self.assertEqual(args.config, r'C:\Mkety\Deriv\connector.json')
        self.assertEqual(args.ledger, r'C:\Mkety\Deriv\ledger.sqlite')

    def test_two_replay_ledgers_are_isolated(self):
        with tempfile.TemporaryDirectory() as td:
            first = module.ReplayLedger(Path(td) / 'octa.sqlite')
            second = module.ReplayLedger(Path(td) / 'deriv.sqlite')
            first.put('same-command-id', {'ok': True, 'order_id': 'octa-order'})
            self.assertEqual(first.get('same-command-id')['order_id'], 'octa-order')
            self.assertIsNone(second.get('same-command-id'))


if __name__ == '__main__':
    unittest.main()
