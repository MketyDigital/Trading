import tempfile
import unittest
from pathlib import Path

from terminal_catalog import (
    TerminalCatalog,
    TerminalInstall,
    discover_terminals,
    find_terminals_in_folder,
    validate_installer_path,
    validate_new_install_target,
    validate_terminal_path,
)


class TerminalCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.exe_a = self.root / "Broker A" / "terminal64.exe"
        self.exe_b = self.root / "Broker B" / "terminal64.exe"
        self.exe_a.parent.mkdir(parents=True)
        self.exe_b.parent.mkdir(parents=True)
        self.exe_a.write_bytes(b"exe")
        self.exe_b.write_bytes(b"exe")

    def tearDown(self):
        self.temp.cleanup()

    def test_discovery_merges_registry_common_paths_and_running_processes(self):
        entries = discover_terminals(
            registry_reader=lambda: [self.exe_a],
            process_reader=lambda: [self.exe_b, self.exe_a],
            common_paths=[self.exe_b],
        )
        by_path = {entry.path: entry for entry in entries}
        self.assertEqual(set(by_path), {self.exe_a.resolve(), self.exe_b.resolve()})
        self.assertTrue(by_path[self.exe_a.resolve()].running)
        self.assertTrue(by_path[self.exe_b.resolve()].running)
        self.assertEqual(by_path[self.exe_a.resolve()].source, "registry+running")

    def test_discovery_deduplicates_case_and_relative_path_variants(self):
        entries = discover_terminals(
            registry_reader=lambda: [self.exe_a],
            process_reader=lambda: [self.exe_a.parent / "." / "terminal64.exe"],
            common_paths=[self.exe_a],
        )
        self.assertEqual(len(entries), 1)

    def test_catalog_rejects_two_profiles_for_same_terminal_path(self):
        profiles = [TerminalInstall(self.exe_a, False, "manual", "Existing")]
        catalog = TerminalCatalog(
            registry_reader=lambda: [], process_reader=lambda: [], common_paths=[], profiles=profiles
        )
        with self.assertRaisesRegex(ValueError, "already.*profile|profile.*already"):
            catalog.validate_profile_path(self.exe_a.parent / "." / "terminal64.exe")

    def test_terminal_path_requires_existing_terminal64_executable(self):
        self.assertEqual(validate_terminal_path(self.exe_a), self.exe_a.resolve())
        with self.assertRaisesRegex(ValueError, "terminal64.exe"):
            validate_terminal_path(self.exe_a.parent)
        with self.assertRaisesRegex(ValueError, "exist|found|valid"):
            validate_terminal_path(self.root / "missing" / "terminal64.exe")

    def test_manual_folder_search_is_bounded_to_selected_folder_depth(self):
        nested = self.root / "one" / "two" / "terminal64.exe"
        nested.parent.mkdir(parents=True)
        nested.write_bytes(b"exe")
        deeper = self.root / "one" / "two" / "three" / "terminal64.exe"
        deeper.parent.mkdir()
        deeper.write_bytes(b"exe")
        found = find_terminals_in_folder(self.root / "one", max_depth=1)
        self.assertEqual(found, [nested.resolve()])

    def test_install_target_must_be_new_and_empty(self):
        target = self.root / "New MT5"
        self.assertEqual(validate_new_install_target(target), target.resolve())
        target.mkdir()
        self.assertEqual(validate_new_install_target(target), target.resolve())
        (target / "keep.txt").write_text("keep")
        with self.assertRaises(ValueError):
            validate_new_install_target(target)

    def test_user_selected_installer_must_be_existing_executable(self):
        installer = self.root / "mt5setup.exe"
        installer.write_bytes(b"test installer stub")
        self.assertEqual(validate_installer_path(installer), installer.resolve())
        with self.assertRaisesRegex(ValueError, "installer"):
            validate_installer_path(self.exe_a)
        with self.assertRaisesRegex(ValueError, "exist"):
            validate_installer_path(self.root / "missing.exe")


if __name__ == "__main__":
    unittest.main()
