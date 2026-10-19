"""Tkinter onboarding and profile manager for the universal MT5 connector."""

from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import time
import uuid
import webbrowser
from pathlib import Path

from process_supervisor import ConnectorSupervisor, WorkerSpec
from profile_store import (
    TerminalProfile,
    bind_legacy_terminal,
    load_profiles,
    profile_paths,
    save_profile,
    update_copy_settings,
)
from copy_supervisor import CopyPairSpec, LocalCopySupervisor
from terminal_catalog import (
    OFFICIAL_MT5_DOWNLOAD_URL,
    TerminalCatalog,
    TerminalInstall,
    validate_installer_path,
    validate_new_install_target,
    validate_terminal_path,
)


MKETY_CONNECTIONS_URL = "https://trade.mkety.com/"
WINDOW_TITLE = "Mkety MT5 Connector Manager"


def onboarding_options(terminals):
    if not terminals:
        return [
            ("browse", "Browse for terminal64.exe", True),
            ("install", "Install MetaTrader 5", False),
        ]
    return [
        ("one", "Connect one terminal", True),
        ("multiple", "Set up multiple terminals", False),
    ]


class ManagerViewModel:
    """Testable state/actions behind the Tk screens; contains no trading calls."""

    def __init__(self, app_data_dir: Path, supervisor: ConnectorSupervisor, catalog: TerminalCatalog, copy_supervisor=None):
        self.app_data_dir = Path(app_data_dir)
        self.supervisor = supervisor
        self.catalog = catalog
        self.copy_supervisor = copy_supervisor or LocalCopySupervisor()

    def profiles(self) -> list[TerminalProfile]:
        return load_profiles(self.app_data_dir)

    def _profile(self, profile_id: str) -> TerminalProfile:
        for profile in self.profiles():
            if profile.profile_id == profile_id:
                return profile
        raise ValueError("select a saved MT5 terminal profile")

    def _spec(self, profile: TerminalProfile) -> WorkerSpec:
        paths = profile_paths(profile, self.app_data_dir)
        return WorkerSpec(
            profile_id=profile.profile_id,
            terminal_path=profile.terminal_path or Path(),
            config_path=paths.config_path,
            ledger_path=paths.ledger_path,
            status_path=paths.status_path,
        )

    def add_terminal(self, terminal_path: Path, label: str | None = None) -> TerminalProfile:
        canonical = validate_terminal_path(terminal_path)
        existing = self.profiles()
        self.catalog.profiles = existing
        self.catalog.validate_profile_path(canonical)
        profile = TerminalProfile(
            profile_id="terminal-" + uuid.uuid4().hex[:16],
            label=str(label or canonical.parent.name or "MT5 terminal").strip()[:80],
            terminal_path=canonical,
        )
        save_profile(profile, self.app_data_dir)
        return profile

    def bind_legacy(self, profile_id: str, terminal_path: Path) -> TerminalProfile:
        profile = self._profile(profile_id)
        if not profile.legacy:
            raise ValueError("only the existing single-terminal profile can be bound this way")
        canonical = validate_terminal_path(terminal_path)
        self.catalog.profiles = [item for item in self.profiles() if item.profile_id != profile_id]
        self.catalog.validate_profile_path(canonical)
        bind_legacy_terminal(canonical, self.app_data_dir)
        return self._profile(profile_id)

    def resolve_profile_selection(
        self,
        profile_id: str | None,
        terminal_path: Path | None,
        *,
        confirm_legacy_binding: bool = False,
    ) -> TerminalProfile:
        """Resolve Pair/Start from either a saved profile or the selected installation.

        The legacy profile represents an existing single-terminal connector. Binding its
        executable only records the path; it never moves or replaces its config/ledger.
        """
        if profile_id:
            return self._profile(profile_id)
        if terminal_path is None:
            raise ValueError("choose a saved profile, or select a terminal and add it first")
        canonical = validate_terminal_path(terminal_path)
        profiles = self.profiles()
        canonical_key = str(canonical).casefold()
        match = next((profile for profile in profiles
                      if profile.terminal_path and str(profile.terminal_path.resolve(strict=False)).casefold() == canonical_key), None)
        if match:
            return match
        legacy = next((profile for profile in profiles if profile.legacy and not profile.terminal_path), None)
        if legacy:
            if not confirm_legacy_binding:
                raise ValueError("confirm the existing account before binding its saved connector to a terminal")
            return self.bind_legacy(legacy.profile_id, canonical)
        return self.add_terminal(canonical)

    def pair_profile(self, profile_id: str, token: str, observed_identity: dict, *, confirmed: bool) -> Path:
        profile = self._profile(profile_id)
        if not profile.terminal_path:
            raise ValueError("select or bind an MT5 terminal before pairing")
        paths = profile_paths(profile, self.app_data_dir)
        if paths.config_path.exists():
            raise ValueError("this profile already has a pairing; its saved credential was left unchanged")
        if not str(token or "").strip():
            raise ValueError("paste the Mkety pairing token")
        if not confirmed:
            raise ValueError("confirm that this is the intended broker account before pairing")
        if not observed_identity.get("accountNumber") or not observed_identity.get("serverName"):
            raise ValueError("log in to the intended MT5 account before pairing")
        environment = str(observed_identity.get("environment") or "").casefold()
        if environment not in {"demo", "live"}:
            raise ValueError("the MT5 account environment could not be confirmed")
        from mkety_mt5_connector import DEFAULT_GATEWAY, save_local_config

        save_local_config(paths.config_path, {
            "gateway_url": DEFAULT_GATEWAY,
            "connection_token": str(token).strip(),
            "connector_instance_id": str(uuid.uuid4()),
        })
        return paths.config_path

    def start_profile(self, profile_id: str) -> int:
        profile = self._profile(profile_id)
        if not profile.terminal_path:
            raise ValueError("choose the MT5 terminal executable for this profile first")
        paths = profile_paths(profile, self.app_data_dir)
        if not paths.config_path.exists():
            raise ValueError("pair this profile with its Mkety token before starting it")
        spec = self._spec(profile)
        self.supervisor.register(spec)
        return self.supervisor.start(spec)

    def stop_profile(self, profile_id: str) -> None:
        self.supervisor.stop(profile_id)

    def stop_all(self) -> None:
        for profile in self.profiles():
            self.supervisor.stop(profile.profile_id)

    def configure_copy(self, follower_profile_id: str, parent_profile_id: str, *, enabled=True, lot_multiplier=1.0, fixed_lot=None) -> TerminalProfile:
        follower = self._profile(follower_profile_id)
        parent = self._profile(parent_profile_id)
        if follower.profile_id == parent.profile_id:
            raise ValueError('a profile cannot follow itself')
        if not follower.terminal_path or not parent.terminal_path:
            raise ValueError('both MT5 terminals must be selected before enabling local copy')
        return update_copy_settings(follower, self.app_data_dir, role='follower', parent_profile_id=parent.profile_id,
                                    enabled=enabled, lot_multiplier=lot_multiplier, fixed_lot=fixed_lot)

    def disable_copy(self, profile_id: str) -> TerminalProfile:
        return update_copy_settings(self._profile(profile_id), self.app_data_dir, role='none', enabled=False)

    def start_copy(self, follower_profile_id: str) -> int:
        follower = self._profile(follower_profile_id)
        if follower.copy_role != 'follower' or not follower.copy_enabled or not follower.copy_parent_profile_id:
            raise ValueError('local copy is not enabled for this follower profile')
        parent = self._profile(follower.copy_parent_profile_id)
        follower_paths = profile_paths(follower, self.app_data_dir)
        journal_path = follower_paths.ledger_path.with_name('local-copy-ledger.sqlite')
        return self.copy_supervisor.start(CopyPairSpec(parent.profile_id, follower.profile_id, parent.terminal_path, follower.terminal_path,
                                                        follower.copy_lot_multiplier, follower.copy_fixed_lot, journal_path=journal_path))

    def profile_rows(self) -> list[dict]:
        rows = []
        running_paths = set()
        try:
            running_paths = {
                str(Path(path).expanduser().resolve(strict=False)).casefold()
                for path in self.catalog.process_reader()
            }
        except Exception:
            running_paths = set()
        for profile in self.profiles():
            spec = self._spec(profile)
            self.supervisor.register(spec)
            status = self.supervisor.status(profile.profile_id)
            paths = profile_paths(profile, self.app_data_dir)
            rows.append({
                "profile_id": profile.profile_id,
                "label": profile.label,
                "terminal_path": str(profile.terminal_path) if profile.terminal_path else "Select MT5 terminal",
                "terminal_process": "Running" if profile.terminal_path and str(profile.terminal_path.resolve(strict=False)).casefold() in running_paths else "Stopped",
                "connector_process": "Running" if status.get("process_running") else "Stopped",
                "gateway": status.get("state", "stopped"),
                "account": status.get("account_number") or "Sign in to MT5",
                "server": status.get("server_name") or "",
                "environment": status.get("environment") or "",
                "paired": paths.config_path.exists(),
                "dashboard_sync": "Not confirmed — sync this account in Mkety",
            })
        return rows

    def close_action(self, action: str) -> bool:
        if action == "stop_and_exit":
            self.stop_all()
            return True
        # Minimize and cancel leave the manager and its workers in control.
        return False


def probe_terminal_identity(terminal_path: Path, mt5_module=None) -> dict:
    """Read account identity from one selected terminal; never inspect orders/positions."""
    if mt5_module is None:
        import MetaTrader5 as mt5_module
    initialized = mt5_module.initialize(path=str(validate_terminal_path(terminal_path)))
    if not initialized:
        raise RuntimeError(f"Could not connect to this MT5 terminal: {mt5_module.last_error()}")
    try:
        account = mt5_module.account_info()
        if account is None:
            raise RuntimeError("MT5 is open but no broker account is signed in")
        is_live = getattr(account, "trade_mode", None) == getattr(mt5_module, "ACCOUNT_TRADE_MODE_REAL", object())
        return {
            "accountNumber": str(getattr(account, "login", "")),
            "serverName": str(getattr(account, "server", "")),
            "environment": "live" if is_live else "demo",
        }
    finally:
        mt5_module.shutdown()


def launch_user_installer(installer_path: Path, popen_factory=subprocess.Popen):
    """Launch an explicitly selected setup file interactively, without silent flags."""
    installer = validate_installer_path(installer_path)
    return popen_factory([str(installer)], close_fds=True)


def launch_terminal(terminal_path: Path, popen_factory=subprocess.Popen):
    """Open the selected terminal UI so the user can sign in there."""
    terminal = validate_terminal_path(terminal_path)
    return popen_factory([str(terminal)], close_fds=True)


def _focus_existing_manager():
    if os.name != "nt":
        return False
    from ctypes import wintypes
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
    user32.FindWindowW.restype = wintypes.HWND
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.ShowWindow.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
    user32.SetForegroundWindow.restype = wintypes.BOOL
    hwnd = None
    for _ in range(8):
        hwnd = user32.FindWindowW(None, WINDOW_TITLE)
        if hwnd:
            break
        time.sleep(0.15)
    if not hwnd:
        return False
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    return True


def manager_instance_decision(already_exists: bool, focus_existing) -> bool:
    """Return whether this process should launch its window; focus prior instance otherwise."""
    if already_exists:
        focus_existing()
        return False
    return True


def _acquire_single_instance():
    if os.name != "nt":
        return None, True
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
    kernel32.CreateMutexW.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    ctypes.set_last_error(0)
    handle = kernel32.CreateMutexW(None, False, "Local\\MketyMT5ConnectorManager")
    if not handle:
        return None, True
    already_exists = ctypes.get_last_error() == 183
    if not manager_instance_decision(already_exists, _focus_existing_manager):
        kernel32.CloseHandle(handle)
        return None, False
    return handle, True


def run_manager(app_data_dir: Path, supervisor: ConnectorSupervisor, catalog: TerminalCatalog) -> int:
    """Run a lightweight, on-demand Tkinter manager. UI imports are Windows-lazy."""
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, simpledialog, ttk
    except ImportError as exc:
        raise RuntimeError("Tkinter is required to open the MT5 terminal manager") from exc

    mutex, should_run = _acquire_single_instance()
    if not should_run:
        return 0
    model = ManagerViewModel(app_data_dir, supervisor, catalog)
    root = tk.Tk()
    root.title(WINDOW_TITLE)
    root.geometry("900x620")
    root.minsize(780, 520)

    heading = ttk.Label(root, text="Mkety MT5 Connector", font=("Segoe UI", 18, "bold"))
    heading.pack(anchor="w", padx=18, pady=(16, 4))
    ttk.Label(root, text="Each terminal keeps its own account pairing and connector state.").pack(anchor="w", padx=18)

    flow_text = tk.StringVar(value="Choose one terminal for the simplest setup, or add several.")
    ttk.Label(root, textvariable=flow_text).pack(anchor="w", padx=18, pady=(10, 6))
    setup_mode = tk.StringVar(value="one")
    mode_bar = ttk.Frame(root)
    mode_bar.pack(anchor="w", padx=18, pady=(0, 6))
    ttk.Radiobutton(mode_bar, text="Connect one terminal (recommended)", variable=setup_mode, value="one").pack(side="left", padx=(0, 12))
    ttk.Radiobutton(mode_bar, text="Set up multiple terminals", variable=setup_mode, value="multiple").pack(side="left")
    terminal_list = tk.Listbox(root, height=5, exportselection=False)
    terminal_list.pack(fill="x", padx=18)
    discovered = []

    profiles_box = ttk.Treeview(root, columns=("terminal", "terminal_process", "connector", "account", "gateway", "sync"), show="headings", height=10)
    for column, label, width in (
        ("terminal", "Terminal / broker", 205), ("terminal_process", "MT5 process", 80), ("connector", "Connector", 75), ("account", "Account / server", 165),
        ("gateway", "Gateway", 100), ("sync", "Dashboard identity", 250),
    ):
        profiles_box.heading(column, text=label)
        profiles_box.column(column, width=width, anchor="w")
    profiles_box.pack(fill="both", expand=True, padx=18, pady=12)
    note = ttk.Label(root, text="Dashboard identity sync is verified in Mkety. The manager never marks sync complete locally.", wraplength=850)
    note.pack(anchor="w", padx=18, pady=(0, 8))
    copy_bar = ttk.Frame(root)
    copy_bar.pack(anchor="w", padx=18, pady=(0, 8))

    def refresh_profiles():
        for item in profiles_box.get_children():
            profiles_box.delete(item)
        for row in model.profile_rows():
            profiles_box.insert("", "end", iid=row["profile_id"], values=(
                f"{row['label']}\n{row['terminal_path']}", row["terminal_process"], row["connector_process"],
                f"{row['account']} {row['server']} {row['environment']}", row["gateway"], row["dashboard_sync"],
            ))
        root.after(3000, refresh_status_only)

    def select_saved_profile(profile_id):
        if profile_id in profiles_box.get_children():
            profiles_box.selection_set(profile_id)
            profiles_box.focus(profile_id)
            profiles_box.see(profile_id)

    def refresh_status_only():
        for profile_id in profiles_box.get_children():
            row = next((row for row in model.profile_rows() if row["profile_id"] == profile_id), None)
            if row is not None:
                profiles_box.item(profile_id, values=(
                    f"{row['label']}\n{row['terminal_path']}", row["terminal_process"], row["connector_process"],
                    f"{row['account']} {row['server']} {row['environment']}", row["gateway"], row["dashboard_sync"],
                ))
        root.after(3000, refresh_status_only)

    def discover():
        nonlocal discovered
        try:
            discovered = catalog.discover()
            terminal_list.delete(0, tk.END)
            for item in discovered:
                state = "Running" if item.running else "Installed"
                terminal_list.insert(tk.END, f"{item.display_name or item.path.parent.name} — {state} — {item.path}")
            if not discovered:
                flow_text.set("No terminal found. Browse to terminal64.exe or install MetaTrader 5 interactively.")
        except Exception as exc:
            messagebox.showerror("MT5 discovery", str(exc), parent=root)

    def selected_terminal_path():
        selection = terminal_list.curselection()
        if selection:
            return discovered[selection[0]].path
        return None

    def add_selected():
        path = selected_terminal_path()
        if path is None:
            messagebox.showinfo("Select a terminal", "Choose an MT5 terminal from the list first.", parent=root)
            return
        try:
            legacy = next((profile for profile in model.profiles() if profile.legacy and not profile.terminal_path), None)
            if legacy:
                profile = model.bind_legacy(legacy.profile_id, path)
            else:
                profile = model.add_terminal(path)
            if setup_mode.get() == "multiple":
                flow_text.set("Terminal saved. Sign in, pair it, or select another terminal to add.")
            else:
                flow_text.set("Terminal saved. Sign in inside MT5, then pair this profile with its Mkety token.")
            refresh_profiles()
            select_saved_profile(profile.profile_id)
        except Exception as exc:
            messagebox.showerror("Could not add terminal", str(exc), parent=root)

    def browse_terminal():
        path = filedialog.askopenfilename(title="Select MetaTrader 5 terminal64.exe", filetypes=(("MT5 terminal", "terminal64.exe"), ("Executable", "*.exe")))
        if not path:
            return
        try:
            legacy = next((profile for profile in model.profiles() if profile.legacy and not profile.terminal_path), None)
            if legacy:
                profile = model.bind_legacy(legacy.profile_id, Path(path))
            else:
                profile = model.add_terminal(Path(path))
            flow_text.set(f"Added {profile.label}. Sign in inside MT5 before pairing.")
            refresh_profiles()
            select_saved_profile(profile.profile_id)
        except Exception as exc:
            messagebox.showerror("Could not add terminal", str(exc), parent=root)

    def install_terminal():
        installer = filedialog.askopenfilename(title="Select MT5 setup file", filetypes=(("Windows installer", "*.exe"),))
        if not installer:
            return
        target = filedialog.askdirectory(title="Choose a new or empty MT5 install folder")
        if not target:
            return
        try:
            target = validate_new_install_target(Path(target))
        except Exception as exc:
            messagebox.showerror("Choose a safe install folder", str(exc), parent=root)
            return
        if not messagebox.askokcancel("Install MetaTrader 5", f"The installer will open interactively. Select this new or empty folder:\n\n{target}\n\nThe manager will not pass silent or overwrite flags.", parent=root):
            return
        try:
            launch_user_installer(Path(installer))
            messagebox.showinfo("Finish MT5 setup", "Complete the installer, then refresh terminals and select the new terminal64.exe.", parent=root)
        except Exception as exc:
            messagebox.showerror("Could not launch installer", str(exc), parent=root)

    def add_from_folder_search():
        nonlocal discovered
        folder = filedialog.askdirectory(title="Choose one folder to search (no full-drive scan)")
        if not folder:
            return
        try:
            found = catalog.search_folder(Path(folder)) if hasattr(catalog, "search_folder") else []
            merged = {str(item.path.resolve(strict=False)).casefold(): item for item in discovered}
            for path in found:
                merged[str(path.resolve(strict=False)).casefold()] = TerminalInstall(path, False, "selected-folder", path.parent.name)
            discovered = list(merged.values())
            terminal_list.delete(0, tk.END)
            for item in discovered:
                terminal_list.insert(tk.END, f"{item.display_name or item.path.parent.name} — {item.path}")
        except Exception as exc:
            messagebox.showerror("Folder search", str(exc), parent=root)

    def selected_profile_id():
        selection = profiles_box.selection()
        return selection[0] if selection else None

    def clear_saved_profile_on_terminal_input(_event=None):
        selection = profiles_box.selection()
        if selection:
            profiles_box.selection_remove(*selection)

    def clear_terminal_on_profile_input(_event=None):
        terminal_list.selection_clear(0, tk.END)

    # The two lists represent different actions. Clear the other list's selection
    # after direct user input so Pair/Start always has one unambiguous target.
    terminal_list.bind("<ButtonRelease-1>", clear_saved_profile_on_terminal_input)
    terminal_list.bind("<KeyRelease>", clear_saved_profile_on_terminal_input)
    profiles_box.bind("<ButtonRelease-1>", clear_terminal_on_profile_input)
    profiles_box.bind("<KeyRelease>", clear_terminal_on_profile_input)

    def pair_or_start():
        try:
            selected_id = selected_profile_id()
            terminal_path = selected_terminal_path()
            legacy_needs_binding = False
            if not selected_id and terminal_path is not None:
                terminal_key = str(terminal_path.resolve(strict=False)).casefold()
                profiles = model.profiles()
                matching_profile = any(
                    profile.terminal_path
                    and str(profile.terminal_path.resolve(strict=False)).casefold() == terminal_key
                    for profile in profiles
                )
                legacy_needs_binding = not matching_profile and any(
                    profile.legacy and not profile.terminal_path for profile in profiles
                )

            legacy_identity = None
            if legacy_needs_binding:
                legacy_identity = probe_terminal_identity(terminal_path)
                prompt = (
                    "This saved connector has no recorded MT5 terminal. The selected terminal is logged in as:\n\n"
                    f"Account: {legacy_identity['accountNumber']}\nServer: {legacy_identity['serverName']}\n"
                    f"Environment: {legacy_identity['environment'].upper()}\n\n"
                    "Compare this with the account already connected in Mkety. Continue only if it is the same account."
                )
                if not messagebox.askyesno("Confirm existing MT5 account", prompt, parent=root):
                    return

            profile = model.resolve_profile_selection(
                selected_id,
                terminal_path,
                confirm_legacy_binding=legacy_needs_binding,
            )
            profile_id = profile.profile_id
            refresh_profiles()
            select_saved_profile(profile_id)
            if not profile.terminal_path:
                raise ValueError("add or bind an MT5 terminal to this profile first")
            paths = profile_paths(profile, model.app_data_dir)
            if not paths.config_path.exists():
                if not profile.legacy and not messagebox.askokcancel(
                    "No saved pairing found",
                    "No existing local connector credential was found for this terminal. If this account was already connected through an older connector, cancel and verify its saved config before creating another pairing.\n\nContinue only if you intend to create a new Mkety pairing for this account.",
                    parent=root,
                ):
                    return
                identity = probe_terminal_identity(profile.terminal_path)
                prompt = (f"Account: {identity['accountNumber']}\nServer: {identity['serverName']}\n"
                          f"Environment: {identity['environment'].upper()}\n\nIs this the account you intended to pair?")
                if not messagebox.askyesno("Confirm MT5 account", prompt, parent=root):
                    return
                token = simpledialog.askstring("Mkety pairing token", "Paste the token created for this exact account in Mkety:", show="*", parent=root)
                if not token:
                    return
                model.pair_profile(profile_id, token, identity, confirmed=True)
            model.start_profile(profile_id)
            flow_text.set("Connector worker started. Verify account and sync identity in Mkety.")
            refresh_profiles()
            select_saved_profile(profile_id)
        except Exception as exc:
            messagebox.showerror("Could not start connector", str(exc), parent=root)

    def stop_selected():
        profile_id = selected_profile_id()
        if not profile_id:
            return
        try:
            model.stop_profile(profile_id)
            refresh_profiles()
        except Exception as exc:
            messagebox.showerror("Could not stop connector", str(exc), parent=root)

    def mark_selected_follower():
        profile_id = selected_profile_id()
        if not profile_id:
            messagebox.showinfo("Select follower", "Select the MT5 profile that should follow another terminal.", parent=root)
            return
        parent_id = simpledialog.askstring("Main MT5 profile", "Enter the saved parent profile ID:", parent=root)
        if not parent_id:
            return
        multiplier = simpledialog.askfloat("Follower lot multiplier", "1 = same planned lot", initialvalue=1.0, minvalue=0.000001, parent=root)
        if multiplier is None:
            return
        try:
            model.configure_copy(profile_id, parent_id, enabled=True, lot_multiplier=multiplier)
            flow_text.set("Local MT5 follower saved. Start it explicitly when both terminals are ready.")
            refresh_profiles()
        except Exception as exc:
            messagebox.showerror("Could not enable local copy", str(exc), parent=root)

    def disable_selected_follower():
        profile_id = selected_profile_id()
        if not profile_id:
            return
        try:
            model.disable_copy(profile_id)
            flow_text.set("Local MT5 copying disabled for the selected profile.")
            refresh_profiles()
        except Exception as exc:
            messagebox.showerror("Could not disable local copy", str(exc), parent=root)

    def start_selected_copy():
        profile_id = selected_profile_id()
        if not profile_id:
            return
        try:
            model.start_copy(profile_id)
            flow_text.set("Local MT5 copier started in its own process.")
        except Exception as exc:
            messagebox.showerror("Could not start local copier", str(exc), parent=root)

    ttk.Button(copy_bar, text="Mark selected as local follower", command=mark_selected_follower).pack(side="left", padx=(0, 8))
    ttk.Button(copy_bar, text="Start local copy", command=start_selected_copy).pack(side="left", padx=(0, 8))
    ttk.Button(copy_bar, text="Disable local copy", command=disable_selected_follower).pack(side="left")

    def open_selected_terminal():
        path = selected_terminal_path()
        if path is None:
            profile_id = selected_profile_id()
            if profile_id:
                profile = model._profile(profile_id)
                path = profile.terminal_path
        if path is None:
            messagebox.showinfo("Select a terminal", "Choose an MT5 terminal first.", parent=root)
            return
        try:
            launch_terminal(path)
            flow_text.set("MT5 opened. Sign in inside the terminal, then pair the selected profile.")
        except Exception as exc:
            messagebox.showerror("Could not open terminal", str(exc), parent=root)

    def open_mkety():
        webbrowser.open(MKETY_CONNECTIONS_URL)

    actions = ttk.Frame(root)
    actions.pack(fill="x", padx=18, pady=(0, 14))
    action_rows = (
        (("Refresh terminals", discover), ("Add another terminal", add_selected), ("Browse terminal…", browse_terminal),
         ("Search a folder…", add_from_folder_search), ("Install MT5…", install_terminal)),
        (("Official MT5 download", lambda: webbrowser.open(OFFICIAL_MT5_DOWNLOAD_URL)),
         ("Open selected MT5", open_selected_terminal), ("Pair / start selected", pair_or_start), ("Stop selected connector", stop_selected),
         ("Sync this account in Mkety", open_mkety)),
    )
    for row_actions in action_rows:
        row_frame = ttk.Frame(actions)
        row_frame.pack(anchor="w")
        for label, action in row_actions:
            ttk.Button(row_frame, text=label, command=action).pack(side="left", padx=(0, 5), pady=3)

    def close_window():
        if not model.profiles():
            root.destroy()
            return
        if messagebox.askyesno("Close Mkety MT5 Connector", "Stop all Mkety connector workers and exit? Choose No to keep this manager open.", parent=root):
            try:
                model.close_action("stop_and_exit")
                root.destroy()
            except Exception as exc:
                messagebox.showerror("Could not stop connector workers", str(exc), parent=root)

    root.protocol("WM_DELETE_WINDOW", close_window)
    discover()
    refresh_profiles()
    try:
        root.mainloop()
    finally:
        if mutex:
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(mutex)
    return 0
