import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from local_copier import LocalCopyEngine, plan_snapshot_actions
from profile_store import TerminalProfile, load_profiles, save_profile, update_copy_settings
from copy_supervisor import CopyPairSpec, LocalCopySupervisor


class LocalCopierTests(unittest.TestCase):
    def test_profile_copy_metadata_defaults_off(self):
        profile = TerminalProfile('p1', 'Primary')
        self.assertEqual(profile.copy_role, 'none')
        self.assertFalse(profile.copy_enabled)
        self.assertIsNone(profile.copy_parent_profile_id)

    def test_complete_parent_snapshot_opens_follower_with_scaled_lot(self):
        parent = {'complete': True, 'positions': [{'ticket': '10', 'symbol': 'XAUUSD', 'side': 'BUY', 'volume': 0.2, 'sl': 2300, 'tp': 2400}]}
        follower = {'positions': []}
        actions = plan_snapshot_actions(parent, follower, lot_multiplier=0.5)
        self.assertEqual(actions, [{'type': 'OPEN_POSITION', 'source_ticket': '10', 'symbol': 'XAUUSD', 'side': 'BUY', 'lots': 0.1, 'stop_loss': 2300, 'take_profit': 2400}])

    def test_uncertain_parent_snapshot_never_closes_follower(self):
        parent = {'complete': False, 'positions': []}
        follower = {'positions': [{'source_ticket': '10', 'symbol': 'XAUUSD'}]}
        self.assertEqual(plan_snapshot_actions(parent, follower, lot_multiplier=1), [])

    def test_closed_source_is_not_replayed_by_journal(self):
        from local_copier_worker import CopyJournal
        with tempfile.TemporaryDirectory() as folder:
            with CopyJournal(Path(folder) / 'copy.sqlite') as journal:
                journal.record('10', '20', 'fingerprint')
                self.assertIn('10', journal.follower_rows())
                journal.remove('10')
                self.assertNotIn('10', journal.follower_rows())

    def test_profile_copy_settings_round_trip_without_changing_pairing_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parent = TerminalProfile('p1', 'Primary', Path('C:/primary/terminal64.exe'))
            follower = TerminalProfile('p2', 'Follower', Path('C:/follower/terminal64.exe'))
            save_profile(parent, root)
            save_profile(follower, root)
            update_copy_settings(follower, root, role='follower', parent_profile_id='p1', lot_multiplier=0.5, enabled=True)
            loaded = {row.profile_id: row for row in load_profiles(root)}
            self.assertEqual(loaded['p2'].copy_parent_profile_id, 'p1')
            self.assertTrue(loaded['p2'].copy_enabled)
            self.assertEqual(loaded['p2'].copy_lot_multiplier, 0.5)

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
