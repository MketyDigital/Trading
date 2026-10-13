import json
import tempfile
import unittest
from pathlib import Path

from manager_ui import ManagerViewModel, launch_terminal, launch_user_installer, manager_instance_decision, onboarding_options
from process_supervisor import ConnectorSupervisor
from profile_store import LEGACY_CONFIG_NAME, TerminalProfile, load_profiles, profile_paths, save_profile
from terminal_catalog import TerminalCatalog, TerminalInstall


class ManagerUiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app_data = self.root / "Mkety"
        self.terminal = self.root / "MT5" / "terminal64.exe"
        self.terminal.parent.mkdir()
        self.terminal.write_bytes(b"terminal")
        self.catalog = TerminalCatalog(registry_reader=lambda: [], process_reader=lambda: [], common_paths=[])
        self.supervisor = ConnectorSupervisor(pid_is_running=lambda _pid: False, worker_command_prefix=["python", "worker"])
        self.model = ManagerViewModel(self.app_data, self.supervisor, self.catalog)

    def tearDown(self):
        self.temp.cleanup()

    def test_first_run_offers_one_terminal_by_default_or_multiple(self):
        options = onboarding_options([TerminalInstall(self.terminal, False, "manual", "Broker")])
        self.assertEqual(options[0], ("one", "Connect one terminal", True))
        self.assertEqual(options[1][0], "multiple")

    def test_no_terminal_offers_browse_and_interactive_install_routes(self):
        self.assertEqual(onboarding_options([]), [
            ("browse", "Browse for terminal64.exe", True),
            ("install", "Install MetaTrader 5", False),
        ])

    def test_add_terminal_saves_distinct_profile_and_rejects_existing_path(self):
        profile = self.model.add_terminal(self.terminal, "Demo account")
        self.assertEqual(profile.terminal_path, self.terminal.resolve())
        self.assertEqual(load_profiles(self.app_data), [profile])
        with self.assertRaisesRegex(ValueError, "already.*profile|profile.*already"):
            self.model.add_terminal(self.terminal.parent / "." / "terminal64.exe", "Duplicate")

    def test_pairing_writes_token_only_to_selected_profile_after_identity_confirmation(self):
        profile = self.model.add_terminal(self.terminal, "Demo account")
        identity = {"accountNumber": "123456", "serverName": "Broker-Demo", "environment": "demo"}
        with self.assertRaisesRegex(ValueError, "confirm"):
            self.model.pair_profile(profile.profile_id, "pair-token", identity, confirmed=False)
        self.model.pair_profile(profile.profile_id, "pair-token", identity, confirmed=True)
        paths = profile_paths(profile, self.app_data)
        config = json.loads(paths.config_path.read_text())
        self.assertEqual(config["connection_token"], "pair-token")
        self.assertFalse(profile_paths(TerminalProfile("other", "Other", self.terminal), self.app_data).config_path.exists())

    def test_existing_legacy_config_cannot_be_overwritten_by_pairing(self):
        self.app_data.mkdir(parents=True)
        config = self.app_data / LEGACY_CONFIG_NAME
        config.write_text('{"connection_token":"old-token"}')
        original = config.read_bytes()
        profile = load_profiles(self.app_data)[0]
        self.model.bind_legacy(profile.profile_id, self.terminal)
        with self.assertRaisesRegex(ValueError, "already has a pairing"):
            self.model.pair_profile(profile.profile_id, "new-token", {"accountNumber": "1"}, confirmed=True)
        self.assertEqual(config.read_bytes(), original)

    def test_pair_selection_resolves_explicit_terminal_to_existing_legacy_profile(self):
        self.app_data.mkdir(parents=True)
        config = self.app_data / LEGACY_CONFIG_NAME
        original = b'{"connection_token":"old-token"}'
        config.write_bytes(original)
        legacy = load_profiles(self.app_data)[0]

        with self.assertRaisesRegex(ValueError, "confirm the existing account"):
            self.model.resolve_profile_selection(None, self.terminal)

        self.assertIsNone(load_profiles(self.app_data)[0].terminal_path)
        resolved = self.model.resolve_profile_selection(None, self.terminal, confirm_legacy_binding=True)

        self.assertEqual(resolved.profile_id, legacy.profile_id)
        self.assertEqual(resolved.terminal_path, self.terminal.resolve())
        self.assertEqual(config.read_bytes(), original)

    def test_pair_selection_resolves_terminal_to_matching_saved_profile(self):
        saved = self.model.add_terminal(self.terminal)

        resolved = self.model.resolve_profile_selection(None, self.terminal.parent / "." / "terminal64.exe")

        self.assertEqual(resolved.profile_id, saved.profile_id)

    def test_pair_selection_creates_profile_for_selected_installation(self):
        resolved = self.model.resolve_profile_selection(None, self.terminal)

        self.assertEqual(resolved.terminal_path, self.terminal.resolve())
        self.assertEqual(load_profiles(self.app_data), [resolved])

    def test_pair_selection_without_profile_or_terminal_requires_a_selection(self):
        with self.assertRaisesRegex(ValueError, "choose a saved profile"):
            self.model.resolve_profile_selection(None, None)

    def test_identity_sync_is_never_reported_as_done_by_local_manager(self):
        profile = self.model.add_terminal(self.terminal, "Demo account")
        row = self.model.profile_rows()[0]
        self.assertEqual(row["profile_id"], profile.profile_id)
        self.assertEqual(row["dashboard_sync"], "Not confirmed — sync this account in Mkety")
        self.assertEqual(row["terminal_process"], "Stopped")

    def test_terminal_process_and_connector_process_are_reported_separately(self):
        profile = self.model.add_terminal(self.terminal, "Demo account")
        self.catalog.process_reader = lambda: [self.terminal]
        row = self.model.profile_rows()[0]
        self.assertEqual(row["profile_id"], profile.profile_id)
        self.assertEqual(row["terminal_process"], "Running")
        self.assertEqual(row["connector_process"], "Stopped")

    def test_second_launch_focuses_existing_manager_and_does_not_start_another(self):
        focused = []
        should_launch = manager_instance_decision(True, lambda: focused.append("focused"))
        self.assertFalse(should_launch)
        self.assertEqual(focused, ["focused"])
        self.assertTrue(manager_instance_decision(False, lambda: self.fail("no existing window")))

    def test_installer_launch_is_interactive_and_receives_no_silent_install_flags(self):
        installer = self.root / "mt5setup.exe"
        installer.write_bytes(b"installer")
        invocations = []
        launch_user_installer(installer, popen_factory=lambda args, **kwargs: invocations.append((args, kwargs)))
        self.assertEqual(invocations[0][0], [str(installer.resolve())])
        self.assertNotIn("/silent", str(invocations[0]).lower())

    def test_open_terminal_launches_only_selected_executable(self):
        invocations = []
        launch_terminal(self.terminal, popen_factory=lambda args, **kwargs: invocations.append((args, kwargs)))
        self.assertEqual(invocations[0][0], [str(self.terminal.resolve())])

    def test_minimize_and_cancel_do_not_stop_workers_but_confirmed_close_does(self):
        profile = self.model.add_terminal(self.terminal, "Demo account")
        paths = profile_paths(profile, self.app_data)
        paths.config_path.parent.mkdir(parents=True)
        paths.config_path.write_text('{"gateway_url":"wss://example","connection_token":"token"}')
        self.model.start_profile(profile.profile_id)
        self.model.close_action("minimize")
        self.model.close_action("cancel")
        self.assertIsNone(self.supervisor._processes[profile.profile_id].returncode)
        self.model.close_action("stop_and_exit")
        self.assertNotIn(profile.profile_id, self.supervisor._processes)


if __name__ == "__main__":
    unittest.main()
