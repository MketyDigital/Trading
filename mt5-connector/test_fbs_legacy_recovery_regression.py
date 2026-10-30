"""Regression checks for FBS legacy reconnect and safe profile removal."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from process_supervisor import _is_gateway_worker_command
from profile_store import TerminalProfile, save_profile, load_profiles, remove_saved_profile


class LegacyRecoveryRegressions(unittest.TestCase):
    def test_copy_worker_never_blocks_gateway_by_executable_name(self):
        self.assertFalse(_is_gateway_worker_command(r'C:\\MketyMT5Connector.exe --local-copy-worker --parent-profile legacy-default'))
        self.assertFalse(_is_gateway_worker_command(r'"C:\\MketyMT5Connector.exe"'))
        self.assertTrue(_is_gateway_worker_command(r'C:\\MketyMT5Connector.exe --worker --profile-id legacy-default'))
        self.assertTrue(_is_gateway_worker_command(None))

    def test_unavailable_terminal_profile_can_be_removed_without_deleting_files(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)
            missing=base/'deleted-MT5'/'terminal64.exe'
            profile=TerminalProfile(profile_id='terminal-test',label='Old MT5',terminal_path=missing)
            save_profile(profile,base)
            keep=base/'terminals'/'terminal-test'/'ledger.sqlite'
            keep.parent.mkdir(parents=True)
            keep.write_text('historical ledger',encoding='utf8')
            remove_saved_profile('terminal-test',base)
            self.assertFalse(any(p.profile_id=='terminal-test' for p in load_profiles(base)))
            self.assertEqual(keep.read_text(encoding='utf8'),'historical ledger')

    def test_cannot_remove_parent_with_saved_follower(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)
            save_profile(TerminalProfile(profile_id='terminal-parent',label='Parent'),base)
            save_profile(TerminalProfile(profile_id='terminal-follower',label='Follower',copy_role='follower',
                                         copy_parent_profile_id='terminal-parent',copy_enabled=True),base)
            with self.assertRaises(ValueError):
                remove_saved_profile('terminal-parent',base)

    def test_legacy_profile_cannot_be_removed(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                remove_saved_profile('legacy-default',Path(d))


if __name__ == '__main__':
    unittest.main()
