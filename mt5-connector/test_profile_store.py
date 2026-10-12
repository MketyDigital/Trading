import json
import tempfile
import unittest
from pathlib import Path

from profile_store import TerminalProfile, bind_legacy_terminal, load_profiles, profile_paths, save_profile


class ProfileStoreTests(unittest.TestCase):
    def test_legacy_profile_uses_original_paths_without_rewriting_credentials(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td) / 'Mkety'
            app_data.mkdir()
            config = app_data / 'mt5-connector.json'
            config.write_text('{"connection_token":"secret-reconnect"}', encoding='utf-8')
            original = config.read_bytes()

            profiles = load_profiles(app_data)

            self.assertEqual(len(profiles), 1)
            self.assertEqual(profiles[0].profile_id, 'legacy-default')
            self.assertTrue(profiles[0].legacy)
            self.assertIsNone(profiles[0].terminal_path)
            paths = profile_paths(profiles[0], app_data)
            self.assertEqual(paths.config_path, config)
            self.assertEqual(paths.ledger_path, app_data / 'mt5-connector-ledger.sqlite')
            self.assertEqual(config.read_bytes(), original)

    def test_legacy_profile_terminal_binding_is_stored_separately_from_credential_file(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td)
            config = app_data / 'mt5-connector.json'
            config.write_text('{"gateway_url":"wss://example","connection_token":"keep"}')
            original = config.read_bytes()
            terminal = Path(td) / 'MT5' / 'terminal64.exe'
            bind_legacy_terminal(terminal, app_data)
            profile = load_profiles(app_data)[0]
            self.assertTrue(profile.legacy)
            self.assertEqual(profile.terminal_path, terminal)
            self.assertIn('keep', config.read_text())
            self.assertEqual(config.read_bytes(), original)

    def test_adding_new_profile_preserves_existing_legacy_terminal_binding(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td)
            (app_data / 'mt5-connector.json').write_text('{"connection_token":"keep"}')
            legacy_path = Path(td) / 'Old' / 'terminal64.exe'
            bind_legacy_terminal(legacy_path, app_data)
            new_profile = TerminalProfile('new-profile', 'New', Path(td) / 'New' / 'terminal64.exe')
            save_profile(new_profile, app_data)
            loaded = load_profiles(app_data)
            self.assertEqual(loaded[0].terminal_path, legacy_path)
            self.assertEqual(loaded[1], new_profile)

    def test_new_profiles_round_trip_with_stable_ids_and_no_credentials_in_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td) / 'Mkety'
            first = TerminalProfile('profile-octa', 'Octa demo', Path(r'C:\MT5\Octa\terminal64.exe'))
            second = TerminalProfile('profile-fbs', 'FBS live', Path(r'C:\MT5\FBS\terminal64.exe'))

            save_profile(first, app_data)
            save_profile(second, app_data)
            loaded = load_profiles(app_data)

            self.assertEqual([p.profile_id for p in loaded], ['profile-octa', 'profile-fbs'])
            self.assertEqual(loaded, [first, second])
            manifest = (app_data / 'profiles.json').read_text(encoding='utf-8')
            self.assertNotIn('connection_token', manifest)
            self.assertNotIn('secret-reconnect', manifest)

    def test_each_new_profile_gets_distinct_config_ledger_and_status_paths(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td) / 'Mkety'
            first = TerminalProfile('profile-a', 'A', Path(r'C:\MT5\A\terminal64.exe'))
            second = TerminalProfile('profile-b', 'B', Path(r'C:\MT5\B\terminal64.exe'))

            first_paths = profile_paths(first, app_data)
            second_paths = profile_paths(second, app_data)

            self.assertNotEqual(first_paths.config_path, second_paths.config_path)
            self.assertNotEqual(first_paths.ledger_path, second_paths.ledger_path)
            self.assertNotEqual(first_paths.status_path, second_paths.status_path)
            self.assertEqual(first_paths.config_path.parent, app_data / 'terminals' / 'profile-a')

    def test_profile_id_cannot_escape_application_data_directory(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td) / 'Mkety'
            profile = TerminalProfile('../outside', 'Bad ID', Path(r'C:\MT5\terminal64.exe'))

            with self.assertRaisesRegex(ValueError, 'profile id'):
                profile_paths(profile, app_data)
            with self.assertRaisesRegex(ValueError, 'profile id'):
                save_profile(profile, app_data)

    def test_profile_manifest_is_written_atomically_and_loaded_from_disk(self):
        with tempfile.TemporaryDirectory() as td:
            app_data = Path(td) / 'Mkety'
            profile = TerminalProfile('profile-1', 'Main', Path(r'C:\MT5\terminal64.exe'))

            save_profile(profile, app_data)

            body = json.loads((app_data / 'profiles.json').read_text(encoding='utf-8'))
            self.assertEqual(body['profiles'][0]['profile_id'], 'profile-1')
            self.assertFalse(list(app_data.glob('profiles.json.*.tmp')))


if __name__ == '__main__':
    unittest.main()
