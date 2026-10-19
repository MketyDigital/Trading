"""Isolated process supervisor for optional local MT5 parent/follower copying."""

from __future__ import annotations

import subprocess
import sys
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CopyPairSpec:
    parent_profile_id: str
    follower_profile_id: str
    parent_terminal_path: Path
    follower_terminal_path: Path
    follower_lot_multiplier: float = 1.0
    follower_fixed_lot: float | None = None
    poll_seconds: int = 2
    journal_path: Path | None = None
    stop_file: Path | None = None
    follower_symbol_map: dict | None = None


class LocalCopySupervisor:
    def __init__(self, *, popen_factory=subprocess.Popen, command_prefix=None):
        self.popen_factory = popen_factory
        if command_prefix is None:
            if getattr(sys, 'frozen', False):
                self.command_prefix = [sys.executable, '--local-copy-worker']
            else:
                self.command_prefix = [sys.executable, str(Path(__file__).with_name('local_copier_worker.py'))]
        else:
            self.command_prefix = list(command_prefix)
        self._processes = {}

    def start(self, spec: CopyPairSpec):
        key = f'{spec.parent_profile_id}:{spec.follower_profile_id}'
        process = self._processes.get(key)
        if process is not None and process.poll() is None:
            return process.pid
        if spec.stop_file is not None:
            Path(spec.stop_file).unlink(missing_ok=True)
        args = self.command_prefix + [
            '--parent-profile', spec.parent_profile_id,
            '--follower-profile', spec.follower_profile_id,
            '--parent-terminal', str(spec.parent_terminal_path),
            '--follower-terminal', str(spec.follower_terminal_path),
            '--lot-multiplier', str(spec.follower_lot_multiplier),
            '--poll-seconds', str(spec.poll_seconds),
        ]
        if spec.follower_fixed_lot is not None:
            args.extend(['--fixed-lot', str(spec.follower_fixed_lot)])
        if spec.follower_symbol_map:
            args.extend(['--symbol-map', json.dumps(spec.follower_symbol_map, separators=(',', ':'))])
        if spec.journal_path is not None:
            args.extend(['--journal', str(spec.journal_path)])
        if spec.stop_file is not None:
            args.extend(['--stop-file', str(spec.stop_file)])
        process = self.popen_factory(args, close_fds=True)
        self._processes[key] = process
        return process.pid

    def stop(self, parent_profile_id: str, follower_profile_id: str, *, stop_file: Path | None = None):
        key = f'{parent_profile_id}:{follower_profile_id}'
        if stop_file is not None:
            stop_file = Path(stop_file)
            stop_file.parent.mkdir(parents=True, exist_ok=True)
            stop_file.touch()
        process = self._processes.get(key)
        if process is None or process.poll() is not None:
            self._processes.pop(key, None)
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except (AttributeError, subprocess.TimeoutExpired):
            pass
        self._processes.pop(key, None)

    def stop_all(self):
        for key in tuple(self._processes):
            parent_profile_id, follower_profile_id = key.split(':', 1)
            self.stop(parent_profile_id, follower_profile_id)

