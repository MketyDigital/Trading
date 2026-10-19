import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from local_copier import LocalCopyEngine, plan_snapshot_actions
from profile_store import TerminalProfile, load_profiles, save_profile, update_copy_settings
from copy_supervisor import CopyPairSpec, LocalCopySupervisor


class LocalCopierTests(unittest.TestCase):
    def test_snapshot_reads_account_mode_and_follower_symbol_volume_rules(self):
        from local_copier_worker import _snapshot
        class FakeMT5:
            ORDER_TYPE_BUY = 0
            ACCOUNT_MARGIN_MODE_RETAIL_NETTING = 0
            ACCOUNT_MARGIN_MODE_EXCHANGE = 1
            ACCOUNT_MARGIN_MODE_RETAIL_HEDGING = 2
            def initialize(self, **_kwargs): return True
            def shutdown(self): pass
            def account_info(self): return SimpleNamespace(margin_mode=self.ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
            def positions_get(self): return (SimpleNamespace(ticket=12, symbol='Volatility 75 Index', type=0, volume=0.2, sl=0, tp=0),)
            def symbol_info(self, _symbol): return SimpleNamespace(volume_min=0.1, volume_step=0.1)
        snapshot = _snapshot(FakeMT5(), 'deriv-terminal.exe')
        self.assertTrue(snapshot['complete'])
        self.assertEqual(snapshot['account_mode'], 'HEDGING')
        self.assertEqual(snapshot['positions'][0]['volume_min'], 0.1)
        self.assertEqual(snapshot['positions'][0]['volume_step'], 0.1)

    def test_profile_copy_metadata_defaults_off(self):
        profile = TerminalProfile('p1', 'Primary')
        self.assertEqual(profile.copy_role, 'none')
        self.assertFalse(profile.copy_enabled)
        self.assertIsNone(profile.copy_parent_profile_id)

    def test_normal_follower_setup_does_not_require_aliases_and_preserves_saved_aliases(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent = TerminalProfile('p1', 'Primary', Path('C:/primary/terminal64.exe'))
            follower = TerminalProfile('p2', 'Follower', Path('C:/follower/terminal64.exe'))
            save_profile(parent, root)
            save_profile(follower, root)
            update_copy_settings(follower, root, role='follower', parent_profile_id='p1', enabled=True,
                                 symbol_map={'XAUUSD': 'GOLD'})
            current = {row.profile_id: row for row in load_profiles(root)}['p2']
            update_copy_settings(current, root, role='follower', parent_profile_id='p1', enabled=True)
            reloaded = {row.profile_id: row for row in load_profiles(root)}['p2']
            self.assertTrue(reloaded.copy_enabled)
            self.assertEqual(reloaded.copy_symbol_map, {'XAUUSD': 'GOLD'})

    def test_complete_parent_snapshot_opens_follower_with_scaled_lot(self):
        parent = {'complete': True, 'positions': [{'ticket': '10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.2, 'sl': 2300, 'tp': 2400}]}
        follower = {'positions': []}
        actions = plan_snapshot_actions(parent, follower, lot_multiplier=0.5)
        self.assertEqual(actions, [{'type': 'OPEN_POSITION', 'source_ticket': '10', 'symbol': 'XAUUSD', 'side': 'BUY', 'lots': 0.1, 'stop_loss': 2300, 'take_profit': 2400}])

    def test_explicit_symbol_mapping_routes_deriv_style_parent_symbol_to_follower_symbol(self):
        parent = {'complete': True, 'positions': [{'ticket': '10', 'symbol': 'Volatility 75 Index', 'side': 'BUY', 'volume': 0.2, 'sl': 1, 'tp': 2}]}
        actions = plan_snapshot_actions(parent, {'positions': []}, lot_multiplier=1, symbol_map={'Volatility 75 Index': 'Volatility 75 (1s) Index'})
        self.assertEqual(actions[0]['symbol'], 'Volatility 75 (1s) Index')

    def test_netting_follower_does_not_merge_multiple_parent_positions_on_one_symbol(self):
        parent = {'complete': True, 'positions': [
            {'ticket': '10', 'symbol': 'EURUSD', 'side': 'BUY', 'volume': 0.1},
            {'ticket': '11', 'symbol': 'EURUSD', 'side': 'BUY', 'volume': 0.2},
        ]}
        follower = {'account_mode': 'NETTING', 'positions': []}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [])

    def test_netting_follower_does_not_add_to_an_unlinked_manual_position(self):
        parent = {'complete': True, 'positions': [{'ticket': '10', 'symbol': 'EURUSD', 'side': 'BUY', 'volume': 0.1}]}
        follower = {'account_mode': 'NETTING', 'positions': [{'ticket': 'manual-1', 'symbol': 'EURUSD', 'volume': 0.3}]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [])

    def test_fixed_lot_size_uses_the_requested_follower_volume(self):
        parent = {'complete': True, 'positions': [{'ticket': '10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.2}]}
        follower = {'positions': []}
        actions = plan_snapshot_actions(parent, follower, lot_multiplier=1, fixed_lot=0.01)
        self.assertEqual(actions[0]['lots'], 0.01)

    def test_fixed_lot_size_takes_precedence_over_multiplier(self):
        parent = {'complete': True, 'positions': [{'ticket': '10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.2}]}
        actions = plan_snapshot_actions(parent, {'positions': []}, lot_multiplier=2, fixed_lot=0.1)
        self.assertEqual(actions[0]['lots'], 0.1)

    def test_uncertain_parent_snapshot_never_closes_follower(self):
        parent = {'complete': False, 'positions': []}
        follower = {'positions': [{'source_ticket': '10', 'symbol': 'XAUUSD'}]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [])

    def test_unlinked_follower_positions_are_never_closed_by_copy_reconciliation(self):
        parent = {'complete': True, 'positions': []}
        follower = {'positions': [
            {'ticket': 'manual-22', 'symbol': 'EURUSD', 'side': 'BUY', 'volume': 0.1},
            {'ticket': 'copy-33', 'source_ticket': '', 'symbol': 'XAUUSD', 'side': 'SELL', 'volume': 0.2},
        ]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [])

    def test_parent_close_only_closes_the_follower_position_owned_by_this_copy_link(self):
        parent = {'complete': True, 'positions': []}
        follower = {'positions': [
            {'ticket': 'copy-33', 'source_ticket': 'parent-10'},
            {'ticket': 'manual-22', 'symbol': 'EURUSD'},
        ]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [
            {'type': 'CLOSE_POSITION', 'source_ticket': 'parent-10', 'position_id': 'copy-33'}
        ])

    def test_partial_parent_close_closes_the_same_fraction_of_a_fixed_lot_follower(self):
        parent = {'complete': True, 'positions': [{'ticket': 'parent-10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.1, 'sl': 0, 'tp': 0}]}
        follower = {'positions': [{'ticket': 'copy-33', 'source_ticket': 'parent-10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 1.0,
                                   'source_initial_volume': 0.2, 'sl': 0, 'tp': 0, 'volume_min': 0.01, 'volume_step': 0.01}]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1, fixed_lot=1.0), [
            {'type': 'CLOSE_PARTIAL', 'source_ticket': 'parent-10', 'position_id': 'copy-33', 'lots': 0.5}
        ])

    def test_partial_parent_close_scales_the_follower_by_multiplier(self):
        parent = {'complete': True, 'positions': [{'ticket': 'parent-10', 'symbol': 'EURUSD', 'side': 'SELL', 'volume': 0.1, 'sl': 0, 'tp': 0}]}
        follower = {'positions': [{'ticket': 'copy-33', 'source_ticket': 'parent-10', 'symbol': 'EURUSD', 'side': 'SELL', 'volume': 0.2,
                                   'source_initial_volume': 0.2, 'sl': 0, 'tp': 0, 'volume_min': 0.01, 'volume_step': 0.01}]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [
            {'type': 'CLOSE_PARTIAL', 'source_ticket': 'parent-10', 'position_id': 'copy-33', 'lots': 0.1}
        ])

    def test_partial_close_below_broker_minimum_is_not_rounded_up(self):
        parent = {'complete': True, 'positions': [{'ticket': 'parent-10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.19, 'sl': 0, 'tp': 0}]}
        follower = {'positions': [{'ticket': 'copy-33', 'source_ticket': 'parent-10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 1.0,
                                   'source_initial_volume': 0.2, 'sl': 0, 'tp': 0, 'volume_min': 0.1, 'volume_step': 0.1}]}
        self.assertEqual(plan_snapshot_actions(parent, follower, fixed_lot=1.0), [])

    def test_closed_source_is_not_replayed_by_journal(self):
        from local_copier_worker import CopyJournal
        with tempfile.TemporaryDirectory() as folder:
            with CopyJournal(Path(folder) / 'copy.sqlite') as journal:
                journal.record('10', '20', 'fingerprint')
                self.assertIn('10', journal.follower_rows())
                journal.remove('10')
                self.assertNotIn('10', journal.follower_rows())

    def test_copy_journal_preserves_initial_source_volume_across_updates(self):
        from local_copier_worker import CopyJournal
        with tempfile.TemporaryDirectory() as folder:
            with CopyJournal(Path(folder) / 'copy.sqlite') as journal:
                journal.record('10', '20', 'first', 0.2)
                journal.record('10', '20', 'updated', 0.1)
                self.assertEqual(journal.follower_rows()['10']['source_initial_volume'], 0.2)

    def test_worker_sends_partial_close_volume_and_keeps_follower_position_link(self):
        from argparse import Namespace
        from local_copier_worker import CopyJournal, run
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            journal_path = root / 'copy.sqlite'
            with CopyJournal(journal_path) as journal:
                journal.record('parent-10', 'follower-20', 'initial', 0.2)
            stop_file = root / 'stop.signal'
            parent = {'complete': True, 'positions': [{'ticket': 'parent-10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.1, 'sl': 0, 'tp': 0}]}
            follower = {'complete': True, 'positions': [{'ticket': 'follower-20', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 1.0,
                                                           'sl': 0, 'tp': 0, 'volume_min': 0.01, 'volume_step': 0.01}]}
            snapshots = iter([parent, follower])
            calls = []
            class FakeMT5:
                def initialize(self, **_kwargs): return True
                def shutdown(self): pass
            class FakeBroker:
                def execute_reconciled(self, command, command_id):
                    calls.append((command, command_id))
                    return {'ok': True, 'ticket': 'close-deal-999'}
            def sleep(_seconds):
                stop_file.touch()
            with patch('local_copier_worker._load_mt5', return_value=FakeMT5()), \
                    patch('local_copier_worker._snapshot', side_effect=lambda *_args, **_kwargs: next(snapshots)), \
                    patch('local_copier_worker._load_engine', return_value=FakeBroker()), \
                    patch('local_copier_worker.time.sleep', side_effect=sleep):
                run(Namespace(journal=str(journal_path), stop_file=str(stop_file), parent_terminal='parent.exe', follower_terminal='follower.exe',
                              parent_profile='main', follower_profile='copy', lot_multiplier=1.0, fixed_lot=1.0, poll_seconds=1))
            self.assertEqual(calls[0][0], {'action': 'CLOSE_PARTIAL', 'positionId': 'follower-20', 'volume': 0.5})
            with CopyJournal(journal_path) as journal:
                row = journal.follower_rows()['parent-10']
                self.assertEqual(row['ticket'], 'follower-20')
                self.assertEqual(row['source_initial_volume'], 0.2)

    def test_copy_journal_creates_missing_profile_directory(self):
        from local_copier_worker import CopyJournal
        with tempfile.TemporaryDirectory() as folder:
            journal_path = Path(folder) / 'terminals' / 'follower-01' / 'local-copy-ledger.sqlite'
            with CopyJournal(journal_path) as journal:
                journal.record('10', '20', 'fingerprint')
                self.assertIn('10', journal.follower_rows())
            self.assertTrue(journal_path.is_file())

    def test_profile_copy_settings_round_trip_without_changing_pairing_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent = TerminalProfile('p1', 'Primary', Path('C:/primary/terminal64.exe'))
            follower = TerminalProfile('p2', 'Follower', Path('C:/follower/terminal64.exe'))
            save_profile(parent, root)
            save_profile(follower, root)
            update_copy_settings(follower, root, role='follower', parent_profile_id='p1', lot_multiplier=0.5, enabled=True,
                                 symbol_map={'XAUUSD': 'GOLD'})
            loaded = {row.profile_id: row for row in load_profiles(root)}
            self.assertEqual(loaded['p2'].copy_parent_profile_id, 'p1')
            self.assertTrue(loaded['p2'].copy_enabled)
            self.assertEqual(loaded['p2'].copy_lot_multiplier, 0.5)
            self.assertEqual(loaded['p2'].copy_symbol_map, {'XAUUSD': 'GOLD'})

    def test_symbol_mapping_text_accepts_pairs_and_rejects_incomplete_entries(self):
        from profile_store import validate_symbol_map
        self.assertEqual(validate_symbol_map('XAUUSD = GOLD\nVolatility 75 Index = Volatility 75 (1s) Index'),
                         {'XAUUSD': 'GOLD', 'Volatility 75 Index': 'Volatility 75 (1s) Index'})
        with self.assertRaisesRegex(ValueError, 'ParentSymbol = FollowerSymbol'):
            validate_symbol_map('XAUUSD')

    def test_fixed_lot_mode_round_trips_and_is_passed_to_copy_worker(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent_path = root / 'parent' / 'terminal64.exe'
            follower_path = root / 'follower' / 'terminal64.exe'
            parent_path.parent.mkdir(); parent_path.write_bytes(b'parent')
            follower_path.parent.mkdir(); follower_path.write_bytes(b'follower')
            from manager_ui import ManagerViewModel
            from process_supervisor import ConnectorSupervisor
            from terminal_catalog import TerminalCatalog
            calls = []
            class Copies:
                def start(self, spec):
                    calls.append(spec)
                    return 123
                def stop(self, *_args, **_kwargs): pass
                def stop_all(self): pass
            model = ManagerViewModel(
                root / 'appdata',
                ConnectorSupervisor(pid_is_running=lambda _pid: False),
                TerminalCatalog(registry_reader=lambda: [], process_reader=lambda: [], common_paths=[]),
                copy_supervisor=Copies(),
            )
            parent = model.add_terminal(parent_path, 'Main')
            follower = model.add_terminal(follower_path, 'Follower')
            model.configure_copy(follower.profile_id, parent.profile_id, fixed_lot=0.01, symbol_map={'XAUUSD': 'GOLD'})
            loaded = {row.profile_id: row for row in load_profiles(root / 'appdata')}
            self.assertEqual(loaded[follower.profile_id].copy_fixed_lot, 0.01)
            model.start_copy(follower.profile_id)
            self.assertEqual(calls[0].follower_fixed_lot, 0.01)
            self.assertEqual(calls[0].follower_symbol_map, {'XAUUSD': 'GOLD'})

    def test_fixed_one_lot_is_saved_as_a_follower_and_starts_copying(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent_path = root / 'parent' / 'terminal64.exe'
            follower_path = root / 'follower' / 'terminal64.exe'
            parent_path.parent.mkdir(); parent_path.write_bytes(b'parent')
            follower_path.parent.mkdir(); follower_path.write_bytes(b'follower')
            from manager_ui import ManagerViewModel
            from process_supervisor import ConnectorSupervisor
            from terminal_catalog import TerminalCatalog
            calls = []
            class Copies:
                def start(self, spec):
                    calls.append(spec)
                    return 123
                def stop(self, *_args, **_kwargs): pass
                def stop_all(self): pass
            model = ManagerViewModel(
                root / 'appdata',
                ConnectorSupervisor(pid_is_running=lambda _pid: False),
                TerminalCatalog(registry_reader=lambda: [], process_reader=lambda: [], common_paths=[]),
                copy_supervisor=Copies(),
            )
            parent = model.add_terminal(parent_path, 'Octa Demo Main')
            follower = model.add_terminal(follower_path, 'Follower Demo')
            model.configure_copy(follower.profile_id, parent.profile_id, fixed_lot=1.0)

            rows = {row['profile_id']: row for row in model.profile_rows()}
            self.assertEqual(rows[follower.profile_id]['copy'], "Follower of Octa Demo Main — fixed 1 lot (enabled)")
            model.start_copy(follower.profile_id)
            self.assertEqual(calls[0].follower_profile_id, follower.profile_id)
            self.assertEqual(calls[0].follower_fixed_lot, 1.0)

    def test_starting_main_profile_explains_that_it_must_be_configured_as_follower(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            terminal_path = root / 'main' / 'terminal64.exe'
            terminal_path.parent.mkdir(); terminal_path.write_bytes(b'main')
            from manager_ui import ManagerViewModel
            from process_supervisor import ConnectorSupervisor
            from terminal_catalog import TerminalCatalog
            model = ManagerViewModel(
                root / 'appdata',
                ConnectorSupervisor(pid_is_running=lambda _pid: False),
                TerminalCatalog(registry_reader=lambda: [], process_reader=lambda: [], common_paths=[]),
            )
            main = model.add_terminal(terminal_path, 'Octa Main')
            with self.assertRaisesRegex(ValueError, 'Octa Main.*not configured as a local follower'):
                model.start_copy(main.profile_id)

    def test_stopped_unpaired_profile_can_display_read_only_observed_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            terminal_path = root / 'follower' / 'terminal64.exe'
            terminal_path.parent.mkdir(); terminal_path.write_bytes(b'follower')
            from manager_ui import ManagerViewModel
            from process_supervisor import ConnectorSupervisor
            from terminal_catalog import TerminalCatalog
            model = ManagerViewModel(
                root / 'appdata',
                ConnectorSupervisor(pid_is_running=lambda _pid: False),
                TerminalCatalog(registry_reader=lambda: [], process_reader=lambda: [], common_paths=[]),
            )
            profile = model.add_terminal(terminal_path, 'Follower Demo')
            identity = {'accountNumber': '123456', 'serverName': 'Octa-Demo', 'environment': 'demo'}
            observed = model.observe_account(profile.profile_id, probe=lambda _path: identity)

            self.assertEqual(observed, identity)
            row = model.profile_rows()[0]
            self.assertEqual((row['account'], row['server'], row['environment']), ('123456', 'Octa-Demo', 'DEMO'))
            self.assertFalse(row['paired'])

    def test_copy_supervisor_is_separate_process_and_keeps_existing_workers_untouched(self):
        calls = []
        class Process:
            pid = 42
            def poll(self): return None
        supervisor = LocalCopySupervisor(popen_factory=lambda args, close_fds=True: (calls.append(args) or Process()))
        pid = supervisor.start(CopyPairSpec('p1', 'p2', Path('parent.exe'), Path('follower.exe')))
        self.assertEqual(pid, 42)
        self.assertIn('--parent-profile', calls[0])
        self.assertIn('--follower-profile', calls[0])

    def test_copy_supervisor_accepts_pair_specific_journal(self):
        calls = []
        class Process:
            pid = 43
            def poll(self): return None
        supervisor = LocalCopySupervisor(popen_factory=lambda args, close_fds=True: (calls.append(args) or Process()))
        supervisor.start(CopyPairSpec('p1', 'p2', Path('parent.exe'), Path('follower.exe'), journal_path=Path('copy.sqlite')))
        self.assertIn('--journal', calls[0])

    def test_copy_supervisor_passes_saved_symbol_mapping_to_worker(self):
        calls = []
        class Process:
            pid = 44
            def poll(self): return None
        supervisor = LocalCopySupervisor(popen_factory=lambda args, close_fds=True: (calls.append(args) or Process()))
        spec = CopyPairSpec('p1', 'p2', Path('parent.exe'), Path('follower.exe'), follower_symbol_map={'XAUUSD': 'GOLD'})
        supervisor.start(spec)
        mapping_arg = calls[0][calls[0].index('--symbol-map') + 1]
        self.assertEqual(__import__('json').loads(mapping_arg), {'XAUUSD': 'GOLD'})

    def test_stop_signal_can_be_written_after_manager_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            stop_file = Path(folder) / 'local-copy-stop.signal'
            LocalCopySupervisor().stop('parent', 'follower', stop_file=stop_file)
            self.assertTrue(stop_file.exists())

    def test_frozen_copy_worker_relaunches_the_packaged_exe_entrypoint(self):
        calls = []
        class Process:
            pid = 44
            def poll(self): return None
        with patch('copy_supervisor.sys.frozen', True, create=True), \
                patch('copy_supervisor.sys.executable', 'MketyMT5Connector.exe'):
            supervisor = LocalCopySupervisor(popen_factory=lambda args, close_fds=True: (calls.append(args) or Process()))
            supervisor.start(CopyPairSpec('parent', 'follower', Path('parent.exe'), Path('follower.exe')))
        self.assertEqual(calls[0][:2], ['MketyMT5Connector.exe', '--local-copy-worker'])

    def test_stop_and_stop_all_terminate_local_copy_processes(self):
        calls = []
        class Process:
            pid = 45
            def __init__(self): self.terminated = False
            def poll(self): return None
            def terminate(self): self.terminated = True
        processes = []
        def popen(args, close_fds=True):
            calls.append(args)
            process = Process()
            processes.append(process)
            return process
        supervisor = LocalCopySupervisor(popen_factory=popen)
        supervisor.start(CopyPairSpec('parent', 'follower-a', Path('parent.exe'), Path('follower-a.exe')))
        supervisor.start(CopyPairSpec('parent', 'follower-b', Path('parent.exe'), Path('follower-b.exe')))
        supervisor.stop('parent', 'follower-a')
        self.assertTrue(processes[0].terminated)
        self.assertFalse(processes[1].terminated)
        supervisor.stop_all()
        self.assertTrue(processes[1].terminated)

    def test_manager_disable_and_exit_stop_copy_workers(self):
        from manager_ui import ManagerViewModel
        from process_supervisor import ConnectorSupervisor
        from terminal_catalog import TerminalCatalog
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent_path = root / 'parent' / 'terminal64.exe'
            follower_path = root / 'follower' / 'terminal64.exe'
            parent_path.parent.mkdir(); parent_path.write_bytes(b'parent')
            follower_path.parent.mkdir(); follower_path.write_bytes(b'follower')
            stopped = []
            class Copies:
                def start(self, _spec): return 99
                def stop(self, parent_id, follower_id, *, stop_file=None): stopped.append((parent_id, follower_id, stop_file))
                def stop_all(self): stopped.append('all')
            model = ManagerViewModel(
                root / 'appdata',
                ConnectorSupervisor(pid_is_running=lambda _pid: False),
                TerminalCatalog(registry_reader=lambda: [], process_reader=lambda: [], common_paths=[]),
                copy_supervisor=Copies(),
            )
            parent = model.add_terminal(parent_path, 'Main')
            follower = model.add_terminal(follower_path, 'Follower')
            model.configure_copy(follower.profile_id, parent.profile_id)
            model.start_copy(follower.profile_id)
            model.disable_copy(follower.profile_id)
            self.assertEqual(stopped[-1][:2], (parent.profile_id, follower.profile_id))
            self.assertEqual(stopped[-1][2].name, 'local-copy-stop.signal')
            model.configure_copy(follower.profile_id, parent.profile_id)
            model.close_action('stop_and_exit')
            self.assertEqual(stopped[-1], 'all')


if __name__ == '__main__':
    unittest.main()
