"""Small local supervisor for one isolated connector worker per MT5 profile."""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class WorkerSpec:
    profile_id: str
    terminal_path: Path
    config_path: Path
    ledger_path: Path
    status_path: Path


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _canonical_path(path: Path) -> str:
    return os.path.normcase(str(Path(path).expanduser().resolve(strict=False))).casefold()


def _pid_is_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        return _windows_pid_is_running(pid)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _windows_pid_is_running(pid: int, *, api=None, last_error=None) -> bool:
    """Check a Windows PID without sending a signal or terminating the process."""
    import ctypes
    from ctypes import wintypes

    if pid <= 0:
        return False
    if api is None:
        kernel32 = ctypes.WinDLL("kernel32.dll", use_last_error=True)
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel32.CloseHandle.restype = wintypes.BOOL
        api = kernel32
    if last_error is None:
        last_error = getattr(ctypes, "get_last_error", lambda: 87)

    handle = api.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        # Invalid PID means exited. Treat other failures (including access denied)
        # as possibly running so callers fail closed and avoid duplicate workers.
        return int(last_error()) != 87  # ERROR_INVALID_PARAMETER
    try:
        return api.WaitForSingleObject(handle, 0) == 0x00000102  # WAIT_TIMEOUT
    finally:
        api.CloseHandle(handle)


def _terminate_pid(pid: int) -> bool:
    if os.name != "nt":
        try:
            os.kill(pid, signal.SIGTERM)
            return True
        except OSError:
            return False
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32.dll", use_last_error=True)
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
    kernel32.TerminateProcess.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    handle = kernel32.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
    if not handle:
        return False
    try:
        return bool(kernel32.TerminateProcess(handle, 1))
    finally:
        kernel32.CloseHandle(handle)


def _is_gateway_worker_command(command_line: str | None) -> bool:
    """Conservatively classify a packaged connector; unknown command lines block starts."""
    if command_line is None:
        return True
    command = str(command_line).casefold()
    if '--local-copy-worker' in command:
        return False
    if '--worker' in command:
        return True
    # The standalone GUI and PyInstaller bootloader have no worker arguments.
    if 'mketymt5connector.exe' in command:
        return False
    return True


def _windows_connector_command_line(pid: int) -> str | None:
    """Read only process arguments, without changing any process state."""
    if os.name != 'nt':
        return None
    script = ("$p=Get-CimInstance Win32_Process -Filter 'ProcessId = " + str(int(pid)) +
              "'; if($p){[Console]::Write($p.CommandLine)}")
    try:
        output = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
                                capture_output=True, text=True, timeout=8, check=False)
        return output.stdout.strip() if output.returncode == 0 and output.stdout.strip() else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def running_connector_processes() -> list[tuple[int, Path]]:
    """Find packaged Mkety connector executables so old standalone sessions are not duplicated."""
    if os.name != "nt":
        return []
    import ctypes
    from ctypes import wintypes

    psapi = ctypes.WinDLL("Psapi.dll")
    kernel32 = ctypes.WinDLL("kernel32.dll", use_last_error=True)
    psapi.EnumProcesses.argtypes = (ctypes.POINTER(wintypes.DWORD), wintypes.DWORD, ctypes.POINTER(wintypes.DWORD))
    psapi.EnumProcesses.restype = wintypes.BOOL
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    process_ids = (wintypes.DWORD * 4096)()
    bytes_returned = wintypes.DWORD()
    if not psapi.EnumProcesses(process_ids, ctypes.sizeof(process_ids), ctypes.byref(bytes_returned)):
        return []
    results = []
    count = bytes_returned.value // ctypes.sizeof(wintypes.DWORD)
    for pid in process_ids[:count]:
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            continue
        try:
            buffer = ctypes.create_unicode_buffer(32768)
            length = wintypes.DWORD(len(buffer))
            if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)):
                executable = Path(buffer.value)
                if executable.name.casefold() == "mketymt5connector.exe":
                    results.append((int(pid), executable))
        finally:
            kernel32.CloseHandle(handle)
    return results


def _atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, separators=(",", ":"), ensure_ascii=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


class WorkerStatusWriter:
    """Write only sanitized worker state and broker identity metadata."""

    ALLOWED_STATES = {"starting", "authenticating", "authenticated", "connected", "reconnecting", "stopped"}

    def __init__(self, path: Path, profile_id: str, terminal_path: Path, worker_pid: int | None = None):
        self.path = Path(path)
        self.profile_id = str(profile_id)
        self.terminal_path = Path(terminal_path)
        self.worker_pid = int(worker_pid or os.getpid())
        self._status = {
            "profile_id": self.profile_id,
            "state": "starting",
            "terminal_path": str(self.terminal_path),
            "account_number": None,
            "server_name": None,
            "environment": None,
            "worker_pid": self.worker_pid,
            "last_gateway_heartbeat_at": None,
            "updated_at": _utc_now(),
        }
        self.write()

    def update(self, state: str, **details) -> dict:
        if state not in self.ALLOWED_STATES:
            raise ValueError("invalid connector worker state")
        allowed = {"account_number", "server_name", "environment", "last_gateway_heartbeat_at"}
        safe_details = {key: value for key, value in details.items() if key in allowed}
        self._status.update(safe_details)
        self._status["state"] = state
        self._status["updated_at"] = _utc_now()
        self.write()
        return dict(self._status)

    def write(self) -> None:
        _atomic_json(self.path, self._status)


class ConnectorSupervisor:
    def __init__(
        self,
        *,
        popen_factory: Callable = subprocess.Popen,
        pid_is_running: Callable[[int], bool] = _pid_is_running,
        worker_command_prefix: list[str] | None = None,
        connector_process_reader: Callable[[], list[tuple[int, Path]]] = running_connector_processes,
        stale_after_seconds: int = 60,
        graceful_stop_timeout: float = 8.0,
        terminate_pid_fn: Callable[[int], bool] = _terminate_pid,
        sleep_fn: Callable[[float], None] = time.sleep,
    ):
        self.popen_factory = popen_factory
        self.pid_is_running = pid_is_running
        if worker_command_prefix is None:
            worker_command_prefix = [sys.executable]
            if not getattr(sys, "frozen", False):
                worker_command_prefix.append(str(Path(__file__).with_name("mkety_mt5_connector.py")))
        self.worker_command_prefix = list(worker_command_prefix)
        self.connector_process_reader = connector_process_reader
        self.stale_after_seconds = max(1, int(stale_after_seconds))
        self.graceful_stop_timeout = max(0.0, float(graceful_stop_timeout))
        self.terminate_pid_fn = terminate_pid_fn
        self.sleep_fn = sleep_fn
        self._processes: dict[str, object] = {}
        self._specs: dict[str, WorkerSpec] = {}
        self._locks: dict[str, Path] = {}

    def register(self, spec: WorkerSpec) -> None:
        """Remember a saved profile so status can be read after manager restart."""
        self._specs[str(spec.profile_id)] = spec

    def _lock_path(self, spec: WorkerSpec) -> Path:
        return Path(spec.status_path).with_name(f".{spec.profile_id}.worker.lock")

    def _read_lock_pid(self, path: Path) -> int | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            pid = int(payload.get("worker_pid") or 0)
            return pid if pid > 0 else None
        except (OSError, ValueError, json.JSONDecodeError):
            return None

    def _acquire_lock(self, spec: WorkerSpec) -> Path:
        lock_path = self._lock_path(spec)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(2):
            try:
                fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                old_pid = self._read_lock_pid(lock_path)
                if old_pid and self.pid_is_running(old_pid):
                    raise RuntimeError(f"connector worker for profile {spec.profile_id} is already running")
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    continue
                if attempt == 1:
                    raise RuntimeError("could not acquire connector worker lock")
            else:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    json.dump({"worker_pid": os.getpid(), "profile_id": spec.profile_id}, stream)
                return lock_path
        raise RuntimeError("could not acquire connector worker lock")

    def _worker_args(self, spec: WorkerSpec) -> list[str]:
        return self.worker_command_prefix + [
            "--worker", "--profile-id", spec.profile_id,
            "--terminal", str(spec.terminal_path),
            "--config", str(spec.config_path),
            "--ledger", str(spec.ledger_path),
            "--status-file", str(spec.status_path),
            "--stop-file", str(self._stop_path(spec)),
        ]

    def _stop_path(self, spec: WorkerSpec) -> Path:
        return Path(spec.status_path).with_name(f".{spec.profile_id}.worker.stop")

    def start(self, spec: WorkerSpec) -> int:
        profile_id = str(spec.profile_id).strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", profile_id):
            raise ValueError("invalid connector profile id")
        if profile_id in self._processes and self._processes[profile_id].poll() is None:
            raise RuntimeError(f"connector worker for profile {profile_id} is already running")
        terminal_key = _canonical_path(spec.terminal_path)
        managed_pids = {int(process.pid) for process in self._processes.values() if process.poll() is None}
        for registered in self._specs.values():
            pid = self._read_lock_pid(self._lock_path(registered))
            if pid and self.pid_is_running(pid):
                managed_pids.add(pid)
        connector_processes = self.connector_process_reader()
        current_pid = os.getpid()
        # A PyInstaller --onefile app runs with a same-named bootloader parent.
        # Exclude only that direct parent, and only when its image is this exact
        # frozen executable; unrelated connector instances must still block.
        bootloader_parent_pid = None
        if getattr(sys, "frozen", False):
            parent_pid = os.getppid()
            executable_path = _canonical_path(Path(sys.executable))
            if parent_pid != current_pid and any(
                int(pid) == parent_pid and _canonical_path(Path(path)) == executable_path
                for pid, path in connector_processes
            ):
                bootloader_parent_pid = parent_pid
        unmanaged = [
            pid for pid, executable in connector_processes
            if int(pid) != current_pid and int(pid) != bootloader_parent_pid
            and int(pid) not in managed_pids
            and Path(executable).name.casefold() == "mketymt5connector.exe"
        ]
        if unmanaged:
            # Local-copy workers and the packaged GUI share the same executable name.
            # Only a gateway worker (or an uninspectable process) can block another gateway worker.
            conflicting = [pid for pid in unmanaged if _is_gateway_worker_command(_windows_connector_command_line(pid))]
            if conflicting:
                raise RuntimeError("another Mkety MT5 gateway worker is already open; verify its profile before starting")
        for existing_id, existing in self._specs.items():
            process = self._processes.get(existing_id)
            process_running = process is not None and process.poll() is None
            lock_pid = self._read_lock_pid(self._lock_path(existing))
            lock_running = bool(lock_pid and self.pid_is_running(lock_pid))
            if (process_running or lock_running) and _canonical_path(existing.terminal_path) == terminal_key:
                raise ValueError("this MT5 terminal already has a running connector worker")

        lock_path = self._acquire_lock(spec)
        command = self._worker_args(spec)
        options = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL,
                   "stderr": subprocess.DEVNULL, "close_fds": True}
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            options["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            stop_path = self._stop_path(spec)
            try:
                stop_path.unlink()
            except FileNotFoundError:
                pass
            process = self.popen_factory(command, **options)
            _atomic_json(lock_path, {"worker_pid": int(process.pid), "profile_id": profile_id})
        except Exception:
            try:
                lock_path.unlink()
            except FileNotFoundError:
                pass
            raise
        self._processes[profile_id] = process
        self.register(spec)
        self._locks[profile_id] = lock_path
        return int(process.pid)

    def stop(self, profile_id: str) -> None:
        profile_id = str(profile_id)
        process = self._processes.get(profile_id)
        spec = self._specs.get(profile_id)
        if process is None:
            if spec is not None:
                self._stop_orphan(spec)
            return
        if process.poll() is None:
            if spec is not None:
                self._stop_path(spec).write_text("stop", encoding="ascii")
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        self._cleanup_worker_files(spec)
        self._processes.pop(profile_id, None)

    def _pid_is_managed_connector(self, pid: int) -> bool:
        try:
            return any(int(found_pid) == int(pid) and Path(path).name.casefold() == "mketymt5connector.exe"
                       for found_pid, path in self.connector_process_reader())
        except Exception:
            return False

    def _stop_orphan(self, spec: WorkerSpec) -> None:
        lock_path = self._lock_path(spec)
        pid = self._read_lock_pid(lock_path)
        if pid and self.pid_is_running(pid):
            if not self._pid_is_managed_connector(pid):
                raise RuntimeError("saved worker PID is active but is not verified as a Mkety connector process; it was left untouched")
            stop_path = self._stop_path(spec)
            stop_path.parent.mkdir(parents=True, exist_ok=True)
            stop_path.write_text("stop", encoding="ascii")
            deadline = time.monotonic() + self.graceful_stop_timeout
            while self.pid_is_running(pid) and time.monotonic() < deadline:
                self.sleep_fn(0.2)
            if self.pid_is_running(pid):
                if not self._pid_is_managed_connector(pid):
                    raise RuntimeError("worker did not stop and its PID could not be verified; it was left untouched")
                if not self.terminate_pid_fn(pid):
                    raise RuntimeError("could not stop the verified orphan connector worker")
                deadline = time.monotonic() + 5.0
                while self.pid_is_running(pid) and time.monotonic() < deadline:
                    self.sleep_fn(0.2)
                if self.pid_is_running(pid):
                    raise RuntimeError("verified connector worker did not exit after stop request")
        self._cleanup_worker_files(spec)

    def _cleanup_worker_files(self, spec: WorkerSpec | None) -> None:
        if spec is None:
            return
        lock_path = self._locks.pop(spec.profile_id, self._lock_path(spec))
        for path in (lock_path, self._stop_path(spec)):
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def status(self, profile_id: str) -> dict:
        profile_id = str(profile_id)
        spec = self._specs.get(profile_id)
        if spec is not None:
            status_path = Path(spec.status_path)
            local_process = self._processes.get(profile_id)
            if local_process is not None:
                running = local_process.poll() is None
                pid = getattr(local_process, "pid", None) if running else None
            else:
                try:
                    saved = json.loads(status_path.read_text(encoding="utf-8"))
                    pid = int(saved.get("worker_pid") or 0)
                except (OSError, ValueError, json.JSONDecodeError):
                    pid = None
                running = bool(pid and self.pid_is_running(pid))
        else:
            status_path = next((path for path in self._discover_status_paths() if path[0] == profile_id), (None, None))[1]
            if status_path is None:
                return {"profile_id": profile_id, "state": "stopped", "process_running": False}
            try:
                raw = json.loads(status_path.read_text(encoding="utf-8"))
                pid = int(raw.get("worker_pid") or 0)
            except (OSError, ValueError, json.JSONDecodeError):
                raw, pid = {}, None
            running = bool(pid and self.pid_is_running(pid))
        try:
            raw = json.loads(status_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            raw = {}
        result = {key: value for key, value in raw.items() if key in {
            "profile_id", "state", "terminal_path", "account_number", "server_name", "environment",
            "worker_pid", "last_gateway_heartbeat_at", "updated_at",
        }}
        result["profile_id"] = profile_id
        result["process_running"] = running
        if not running:
            result["state"] = "stopped"
        elif result.get("state") == "connected" and not self._heartbeat_is_recent(result.get("last_gateway_heartbeat_at")):
            result["state"] = "disconnected"
        if pid is not None:
            result["worker_pid"] = pid
        return result

    def _heartbeat_is_recent(self, timestamp: str | None) -> bool:
        if not timestamp:
            return False
        try:
            value = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - value).total_seconds()
            return 0 <= age <= self.stale_after_seconds
        except (TypeError, ValueError):
            return False

    def _discover_status_paths(self):
        return [(profile_id, Path(spec.status_path)) for profile_id, spec in self._specs.items()]

