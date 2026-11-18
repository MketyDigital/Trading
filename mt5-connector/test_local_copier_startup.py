"""Regression tests for starting the optional local copier worker from the manager."""

import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from copy_supervisor import CopyPairSpec, LocalCopySupervisor


class FakeProcess:
    pid = 421

    def poll(self):
        return None


class LocalCopierStartupTests(unittest.TestCase):
    def spec(self, folder):
        return CopyPairSpec(
            parent_profile_id='parent',
            follower_profile_id='follower',
            parent_terminal_path=Path(folder) / 'parent' / 'terminal64.exe',
            follower_terminal_path=Path(folder) / 'follower' / 'terminal64.exe',
            stop_file=Path(folder) / 'stop.signal',
            journal_path=Path(folder) / 'journal.sqlite',
        )

    def test_frozen_worker_starts_with_independent_pyinstaller_environment(self):
        calls = []

        def spawn(args, **kwargs):
            calls.append((args, kwargs))
            return FakeProcess()

        with TemporaryDirectory() as folder, patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'executable', 'C:/Mkety/MketyMT5Connector.exe'):
            with patch.dict(os.environ, {'MKETY_COPIER_STARTUP_TEST': 'retained'}, clear=False):
                supervisor = LocalCopySupervisor(popen_factory=spawn)
                self.assertEqual(supervisor.start(self.spec(folder)), 421)
                self.assertEqual(supervisor.start(self.spec(folder)), 421)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][:2], ['C:/Mkety/MketyMT5Connector.exe', '--local-copy-worker'])
        self.assertTrue(calls[0][1]['close_fds'])
        self.assertEqual(calls[0][1]['env']['PYINSTALLER_RESET_ENVIRONMENT'], '1')
        self.assertEqual(calls[0][1]['env']['MKETY_COPIER_STARTUP_TEST'], 'retained')
        self.assertNotIn('PYINSTALLER_RESET_ENVIRONMENT', os.environ)

    def test_script_mode_preserves_existing_launch_contract(self):
        calls = []

        def spawn(args, **kwargs):
            calls.append((args, kwargs))
            return FakeProcess()

        with TemporaryDirectory() as folder, patch.object(sys, 'frozen', False, create=True):
            supervisor = LocalCopySupervisor(popen_factory=spawn)
            supervisor.start(self.spec(folder))
        self.assertEqual(calls[0][1], {'close_fds': True})
        self.assertTrue(calls[0][0][1].endswith('local_copier_worker.py'))

    def test_custom_worker_command_does_not_modify_environment(self):
        calls = []

        def spawn(args, **kwargs):
            calls.append((args, kwargs))
            return FakeProcess()

        with TemporaryDirectory() as folder, patch.object(sys, 'frozen', True, create=True):
            supervisor = LocalCopySupervisor(popen_factory=spawn, command_prefix=['custom-worker.exe'])
            supervisor.start(self.spec(folder))
        self.assertEqual(calls[0][1], {'close_fds': True})


if __name__ == '__main__':
    unittest.main()
