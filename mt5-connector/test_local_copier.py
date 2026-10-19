import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace

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
            journal = CopyJournal(Path(folder) / 'copy.sqlite')
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


if __name__ == '__main__':
    unittest.main()
