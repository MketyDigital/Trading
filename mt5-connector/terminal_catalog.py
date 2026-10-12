"""Bounded, read-only discovery and validation of MetaTrader 5 terminals."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

OFFICIAL_MT5_DOWNLOAD_URL = "https://www.metatrader5.com/en/download"


@dataclass(frozen=True)
class TerminalInstall:
    path: Path
    running: bool
    source: str
    display_name: str | None = None


def validate_terminal_path(path: Path) -> Path:
    """Return a canonical path to an existing MT5 terminal64.exe."""
    candidate = Path(path).expanduser()
    if candidate.name.casefold() != "terminal64.exe":
        raise ValueError("Select the MetaTrader 5 terminal64.exe file")
    try:
        canonical = candidate.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ValueError("The selected MT5 terminal executable does not exist") from exc
    if not canonical.is_file():
        raise ValueError("The selected MT5 terminal executable is not a file")
    return canonical


def _canonical_key(path: Path) -> str:
    return os.path.normcase(str(Path(path).resolve(strict=False))).casefold()


def discover_terminals(
    *,
    registry_reader: Callable[[], Iterable[Path]],
    process_reader: Callable[[], Iterable[Path]],
    common_paths: Iterable[Path],
) -> list[TerminalInstall]:
    """Merge known install locations and running-process paths without disk scans."""
    discovered: dict[str, dict[str, object]] = {}
    for source, paths in (
        ("registry", registry_reader()),
        ("common", common_paths),
        ("running", process_reader()),
    ):
        for raw_path in paths:
            try:
                path = validate_terminal_path(Path(raw_path))
            except (OSError, TypeError, ValueError):
                continue
            key = _canonical_key(path)
            entry = discovered.setdefault(key, {"path": path, "sources": set(), "running": False})
            entry["sources"].add(source)
            if source == "running":
                entry["running"] = True

    result = []
    for entry in discovered.values():
        sources = entry["sources"]
        result.append(TerminalInstall(
            path=entry["path"],
            running=bool(entry["running"]),
            source="+".join(source for source in ("registry", "common", "running") if source in sources),
            display_name=entry["path"].parent.name or None,
        ))
    return sorted(result, key=lambda item: (not item.running, (item.display_name or "").casefold(), str(item.path).casefold()))


def find_terminals_in_folder(folder: Path, *, max_depth: int = 4) -> list[Path]:
    """Search only a user-selected folder and a small, explicit directory depth."""
    root = Path(folder).expanduser().resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Select a folder to search for MT5 terminals")
    if max_depth < 0 or max_depth > 8:
        raise ValueError("Folder search depth must be between 0 and 8")
    found = []
    for current, dirs, files in os.walk(root):
        current_path = Path(current)
        depth = len(current_path.relative_to(root).parts)
        dirs[:] = sorted(name for name in dirs if not name.startswith(".")) if depth < max_depth else []
        if depth <= max_depth and "terminal64.exe" in {name.casefold() for name in files}:
            candidate = current_path / next(name for name in files if name.casefold() == "terminal64.exe")
            try:
                found.append(validate_terminal_path(candidate))
            except ValueError:
                pass
    return sorted(set(found), key=lambda path: str(path).casefold())


def validate_new_install_target(path: Path) -> Path:
    """Reject targets that already contain files or cannot safely be created."""
    target = Path(path).expanduser().resolve(strict=False)
    if target.exists():
        if not target.is_dir():
            raise ValueError("The new MT5 install target must be a folder")
        try:
            if any(target.iterdir()):
                raise ValueError("Choose a new or empty install folder so an existing MT5 install is not overwritten")
        except OSError as exc:
            raise ValueError("The new MT5 install folder cannot be checked") from exc
    parent = target if target.exists() else target.parent
    if not parent.exists() or not parent.is_dir():
        raise ValueError("Choose an install folder under an existing parent folder")
    if not os.access(parent, os.W_OK):
        raise ValueError("The selected MT5 install folder is not writable")
    return target


def validate_installer_path(path: Path) -> Path:
    """Validate a user-selected Windows installer file before interactive launch."""
    installer = Path(path).expanduser()
    if installer.suffix.casefold() != ".exe" or installer.name.casefold() == "terminal64.exe":
        raise ValueError("Select the MT5 Windows installer (.exe) file")
    try:
        canonical = installer.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ValueError("The selected MT5 installer file does not exist") from exc
    if not canonical.is_file():
        raise ValueError("The selected MT5 installer is not a file")
    return canonical


class TerminalCatalog:
    def __init__(
        self,
        *,
        registry_reader: Callable[[], Iterable[Path]] | None = None,
        process_reader: Callable[[], Iterable[Path]] | None = None,
        common_paths: Iterable[Path] | None = None,
        profiles: Iterable[object] = (),
    ):
        self.registry_reader = registry_reader or installed_terminal_paths
        self.process_reader = process_reader or running_terminal_paths
        self.common_paths = list(common_paths) if common_paths is not None else known_common_paths()
        self.profiles = list(profiles)

    def discover(self) -> list[TerminalInstall]:
        return discover_terminals(
            registry_reader=self.registry_reader,
            process_reader=self.process_reader,
            common_paths=self.common_paths,
        )

    def validate_path(self, path: Path) -> Path:
        return validate_terminal_path(path)

    def validate_profile_path(self, path: Path) -> Path:
        canonical = validate_terminal_path(path)
        key = _canonical_key(canonical)
        for profile in self.profiles:
            configured = getattr(profile, "terminal_path", None) or getattr(profile, "path", None)
            if configured is not None and _canonical_key(Path(configured)) == key:
                raise ValueError("This MT5 terminal already has a profile")
        return canonical

    def validate_new_install_target(self, path: Path) -> Path:
        return validate_new_install_target(path)

    def search_folder(self, folder: Path, *, max_depth: int = 4) -> list[Path]:
        return find_terminals_in_folder(folder, max_depth=max_depth)


def known_common_paths() -> list[Path]:
    """A short list of conventional install paths; never walks a whole drive."""
    candidates = []
    for variable in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        base = os.environ.get(variable)
        if base:
            root = Path(base)
            candidates.append(root / "MetaTrader 5" / "terminal64.exe")
    return candidates


def installed_terminal_paths() -> list[Path]:
    """Read MT5 install locations from Windows uninstall registry entries."""
    try:
        import winreg
    except ImportError:
        return []
    found = []
    registry_roots = (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE)
    uninstall_key = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
    views = (getattr(winreg, "KEY_WOW64_64KEY", 0), getattr(winreg, "KEY_WOW64_32KEY", 0))
    for hive in registry_roots:
        for view in views:
            try:
                root = winreg.OpenKey(hive, uninstall_key, 0, winreg.KEY_READ | view)
            except OSError:
                continue
            with root:
                index = 0
                while True:
                    try:
                        subkey_name = winreg.EnumKey(root, index)
                    except OSError:
                        break
                    index += 1
                    try:
                        with winreg.OpenKey(root, subkey_name) as subkey:
                            display = str(winreg.QueryValueEx(subkey, "DisplayName")[0])
                            if "metatrader" not in display.casefold() and "metaquotes" not in display.casefold():
                                continue
                            install = Path(str(winreg.QueryValueEx(subkey, "InstallLocation")[0]))
                            found.extend((install / "terminal64.exe", install / "terminal.exe"))
                    except (OSError, ValueError):
                        continue
    return found


def running_terminal_paths() -> list[Path]:
    """Read executable paths for live MT5 processes using the Windows process API."""
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
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            continue
        try:
            buffer = ctypes.create_unicode_buffer(32768)
            length = wintypes.DWORD(len(buffer))
            if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)):
                path = Path(buffer.value)
                if path.name.casefold() == "terminal64.exe":
                    results.append(path)
        finally:
            kernel32.CloseHandle(handle)
    return results
