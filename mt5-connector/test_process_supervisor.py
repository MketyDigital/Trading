import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from process_supervisor import ConnectorSupervisor, WorkerSpec, _pid_is_running


class FakeProcess:
    next_pid = 2000

    def __init__(self, args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.pid = FakeProcess.next_pid
        FakeProcess.next_pid += 1
        self.returncode = None
        self.terminated = False

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = 0

    def wait(self, timeout=None):
        return self.returncode


class ProcessSupervisorTests(unittest.TestCase):
    def test_pid_probe_detects_current_process_and_rejects_invalid_pid(self):
        self.assertTrue(_pid_is_running(os.getpid()))
        self.assertFalse(_pid_is_running(0))
        self.assertFalse(_pid_is_running(-1))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.processes = []

        def popen(args, **kwargs):
            process = FakeProcess(args, **kwargs)
            self.processes.append(process)
            return process

        self.supervisor = ConnectorSupervisor(
            popen_factory=popen,
            pid_is_running=lambda pid: False,
            worker_command_prefix=["python", "connector.py"],
        )
        self.first = self.spec("alpha", "Alpha")
        self.second = self.spec("beta", "Beta")

    def tearDown(self):
        self.temp.cleanup()

    def spec(self, profile_id, folder):
        base = self.root / folder
        return WorkerSpec(
            profile_id=profile_id,
            terminal_path=base / "terminal64.exe",
            config_path=base / "connector.json",
            ledger_path=base / "ledger.sqlite",
            status_path=base / "status.json",
        )

    def test_start_uses_isolated_paths_and_profile_identity(self):
        pid = self.supervisor.start(self.first)
        self.assertEqual(pid, self.processes[0].pid)
        args = self.processes[0].args
        for flag, value in (
            ("--terminal", self.first.terminal_path),
            ("--config", self.first.config_path),
            ("--ledger", self.first.ledger_path),
            ("--status-file", self.first.status_path),
            ("--profile-id", self.first.profile_id),
        ):
            self.assertEqual(args[args.index(flag) + 1], str(value))
        self.assertIn("--worker", args)

    def test_duplicate_profile_start_is_rejected(self):
        self.supervisor.start(self.first)
        with self.assertRaisesRegex(RuntimeError, "already running"):
            self.supervisor.start(self.first)
        self.assertEqual(len(self.processes), 1)

    def test_unmanaged_legacy_connector_process_blocks_duplicate_session(self):
        guarded = ConnectorSupervisor(
            popen_factory=lambda *args, **kwargs: self.fail("must not start a duplicate worker"),
            pid_is_running=lambda _pid: False,
            worker_command_prefix=["python", "connector.py"],
            connector_process_reader=lambda: [(7777, Path("MketyMT5Connector.exe"))],
        )
        with self.assertRaisesRegex(RuntimeError, "another Mkety MT5 Connector session"):
            guarded.start(self.first)

    def test_duplicate_canonical_terminal_path_is_rejected(self):
        self.supervisor.start(self.first)
        duplicate = WorkerSpec(
            profile_id="other",
            terminal_path=self.first.terminal_path.parent / "." / "terminal64.exe",
            config_path=self.second.config_path,
            ledger_path=self.second.ledger_path,
            status_path=self.second.status_path,
        )
        with self.assertRaisesRegex(ValueError, "terminal.*already|already.*terminal"):
            self.supervisor.start(duplicate)
        self.assertEqual(len(self.processes), 1)

    def test_stop_only_stops_requested_worker(self):
        self.supervisor.start(self.first)
        self.supervisor.start(self.second)
        self.supervisor.stop("alpha")
        self.assertTrue(self.processes[0].terminated)
        self.assertFalse(self.processes[1].terminated)

    def test_status_reports_stale_pid_as_stopped(self):
        self.first.status_path.parent.mkdir(parents=True)
        self.first.status_path.write_text(json.dumps({
            "profile_id": "alpha", "state": "connected", "worker_pid": 999999,
            "last_gateway_heartbeat_at": "2026-01-01T00:00:00Z",
        }))
        self.supervisor.register(self.first)
        status = self.supervisor.status("alpha")
        self.assertEqual(status["state"], "stopped")
        self.assertFalse(status["process_running"])
        self.assertTrue(self.first.status_path.exists())

    def test_registered_profile_can_recover_live_worker_status_after_manager_restart(self):
        self.first.status_path.parent.mkdir(parents=True)
        self.first.status_path.write_text(json.dumps({
            "profile_id": "alpha", "state": "connected", "worker_pid": 2001,
            "last_gateway_heartbeat_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }))
        restarted = ConnectorSupervisor(pid_is_running=lambda pid: pid == 2001)
        restarted.register(self.first)
        status = restarted.status("alpha")
        self.assertEqual(status["state"], "connected")
        self.assertTrue(status["process_running"])

    def test_manager_restart_can_request_shutdown_of_registered_orphan_worker(self):
        checks = {"count": 0}

        def pid_is_running(pid):
            checks["count"] += 1
            return checks["count"] == 1

        restarted = ConnectorSupervisor(
            pid_is_running=pid_is_running,
            connector_process_reader=lambda: [(2222, Path("MketyMT5Connector.exe"))],
        )
        restarted.register(self.first)
        lock = restarted._lock_path(self.first)
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({"worker_pid": 2222, "profile_id": "alpha"}))
        restarted.stop("alpha")
        self.assertFalse(lock.exists())
        self.assertFalse(restarted._stop_path(self.first).exists())

    def test_unverified_active_pid_is_left_untouched(self):
        terminated = []
        restarted = ConnectorSupervisor(
            pid_is_running=lambda _pid: True,
            connector_process_reader=lambda: [],
            terminate_pid_fn=lambda pid: terminated.append(pid) or True,
        )
        restarted.register(self.first)
        lock = restarted._lock_path(self.first)
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({"worker_pid": 2223, "profile_id": "alpha"}))
        with self.assertRaisesRegex(RuntimeError, "not verified"):
            restarted.stop("alpha")
        self.assertEqual(terminated, [])
        self.assertTrue(lock.exists())

    def test_stale_profile_lock_does_not_block_restart(self):
        lock = self.supervisor._lock_path(self.first)
        lock.parent.mkdir(parents=True)
        lock.write_text(json.dumps({"worker_pid": 999999, "profile_id": "alpha"}))
        self.assertEqual(self.supervisor.start(self.first), self.processes[0].pid if self.processes else 2000)
        self.assertEqual(len(self.processes), 1)


if __name__ == "__main__":
    unittest.main()
