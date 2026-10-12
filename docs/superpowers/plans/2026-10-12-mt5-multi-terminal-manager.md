# MT5 Multi-Terminal Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a beginner-friendly multi-terminal manager to the universal Windows MT5 connector while preserving the existing single-terminal pairing and execution behavior.

**Architecture:** Keep the existing connector engine as one worker per MT5 terminal. Add a small Tkinter manager that discovers/launches terminals, stores an isolated profile per terminal, and reads a non-secret local status file from each worker. Keep Mkety pairing and identity sync authority in the existing dashboard/API, with an additive dashboard batch-sync control.

**Tech Stack:** Python 3.11, Tkinter/stdlib, MetaTrader5 Python package, existing PyInstaller Windows one-file workflow, existing Cloudflare dashboard JavaScript and Node.js tests.

**Spec:** `docs/superpowers/specs/2026-10-12-mt5-multi-terminal-manager-design.md`

## Global Constraints

- Supported target is Windows/Windows VPS.
- The single-terminal setup remains available and keeps the existing gateway pairing protocol.
- Do not scan all disks by default; broader search is initiated and bounded by the user.
- Do not run installers silently, overwrite an existing terminal directory, collect broker passwords, or copy saved broker login state.
- Use one connector worker and isolated connector config/replay ledger per active terminal profile.
- Preserve the legacy default connector config and replay-ledger paths without resetting or moving existing credentials.
- Display terminal process, account login, recent gateway heartbeat, and dashboard identity sync as separate states.
- Do not inspect or modify positions/orders, change account execution/risk controls, or change cTrader, cBot, pending-order, or live-trade behavior.
- A new executable build may be validated and stored as a CI artifact; publishing a release or deploying dashboard code is outside this plan.

## Review Focus

- A legacy config already exists and the old connector may still run: test adoption without token reset, state migration, or duplicate worker.
- Two discovery sources return the same terminal path, or two profiles request one path: test canonical-path deduplication and one-worker-per-path enforcement.
- An installer is cancelled, targets an existing directory, or has an unknown layout: test no overwrite, no account-data copy, and clean fallback/error states.
- A terminal is open but logged out or its account/server/environment differs from the Mkety destination: test it never reports a verified connection or completes sync for the wrong identity.
- A heartbeat becomes stale or batch sync partially fails: test disconnected status and independent per-account results without false overall success.

---

## File Map

- Create `mt5-connector/profile_store.py` for profile persistence, legacy-profile recognition, and safe per-profile path derivation.
- Create `mt5-connector/terminal_catalog.py` for Windows terminal discovery, canonical path validation, installer handoff, and clean-copy validation.
- Create `mt5-connector/process_supervisor.py` for one worker per profile, duplicate prevention, start/stop, and process health.
- Create `mt5-connector/manager_ui.py` for first-run choice, terminal picker/add flow, pairing, and returning-user status screen.
- Modify `mt5-connector/mkety_mt5_connector.py` to provide a worker entry mode and atomic non-secret status updates while preserving existing CLI compatibility.
- Create `mt5-connector/test_profile_store.py`, `test_terminal_catalog.py`, `test_process_supervisor.py`, and `test_manager_ui.py`; extend `test_connector.py`, `test_first_run.py`, and `test_multi_instance.py` for status and legacy compatibility.
- Modify `cloudflare-v2/src/dashboard_mt5_connector_connections.js` to use the stable latest-release asset path and add an optional per-account-independent **Sync all pending identities** action.
- Extend `cloudflare-v2/tests/mt5_connector_frontend.test.mjs` for the download path and batch sync outcomes.
- Modify `.github/workflows/mt5-connector-release.yml` so pull requests/branch pushes build and test artifacts, while only a new version tag publishes a release; do not overwrite the existing v1.0.0 asset.
- Update `mt5-connector/README.md` with both onboarding paths, install/clone safety, RAM expectations, and recovery steps.

## Tasks

### Task 1: Persist isolated terminal profiles and status paths

**Files:**
- Create: `mt5-connector/profile_store.py`
- Create: `mt5-connector/test_profile_store.py`
- Test: `mt5-connector/test_first_run.py`
- Test: `mt5-connector/test_multi_instance.py`

**Interfaces:**
- Produce `ProfilePaths(profile_id, config_path, ledger_path, status_path)` and `TerminalProfile(profile_id, label, terminal_path, legacy)` dataclasses.
- Produce `load_profiles(app_data_dir: Path) -> list[TerminalProfile]`, `save_profile(profile: TerminalProfile, app_data_dir: Path) -> None`, and `profile_paths(profile: TerminalProfile, app_data_dir: Path) -> ProfilePaths`.
- Legacy profile maps to the existing `%APPDATA%\\Mkety\\mt5-connector.json` and `mt5-connector-ledger.sqlite` without moving or rewriting either file. New profile paths are unique under `%APPDATA%\\Mkety\\terminals\\<profile_id>\\`.

- [x] **Step 1: Add failing tests** for legacy config recognition, stable profile IDs, unique config/ledger/status paths for two terminals, and profile IDs that cannot escape the Mkety data directory.
- [x] **Step 2: Run the focused tests** with `python -m unittest discover -s mt5-connector -p 'test_profile_store.py' -v`; confirm the new module/import failures.
- [x] **Step 3: Implement profile dataclasses and atomic JSON manifest persistence** in `profile_store.py`. Store paths and labels only; never store pairing tokens in the manifest.
- [x] **Step 4: Run profile tests plus `python -m unittest discover -s mt5-connector -p 'test_*.py' -v`**; confirm legacy token and path behavior remains intact.
- [x] **Step 5: Commit** as `feat: isolate MT5 connector terminal profiles`.

### Task 2: Discover and validate MT5 terminal installations

**Files:**
- Create: `mt5-connector/terminal_catalog.py`
- Create: `mt5-connector/test_terminal_catalog.py`
- Modify: `mt5-connector/README.md`

**Interfaces:**
- Produce `TerminalInstall(path: Path, running: bool, source: str, display_name: str | None)`.
- Produce `discover_terminals(*, registry_reader, process_reader, common_paths) -> list[TerminalInstall]`; injected readers keep path normalization testable off Windows. `process_reader` returns executable paths for running processes, and `registry_reader` returns installed executable paths.
- Produce a `TerminalCatalog` facade with `discover() -> list[TerminalInstall]`, `validate_path(path: Path) -> Path`, and `validate_new_install_target(path: Path) -> Path`; the manager UI consumes this facade.
- Produce `validate_terminal_path(path: Path) -> Path`; it returns a canonical existing `terminal64.exe` path or raises a user-readable `ValueError`.
- Produce `validate_new_install_target(path: Path) -> Path`; reject existing/non-empty targets.
- Provide an explicit folder-scoped search function; do not provide an implicit full-disk scan.

- [x] **Step 1: Add failing tests** for registry/common-path/process discovery merge, canonical duplicate removal, same-path profile rejection, invalid executable, bounded folder search, and non-empty install-target rejection.
- [x] **Step 2: Run** `python -m unittest discover -s mt5-connector -p 'test_terminal_catalog.py' -v`; confirm expected failures.
- [x] **Step 3: Implement Windows discovery behind injected adapters.** Use registry/common locations and process executable paths; provide a manual picker fallback in the UI task. Do not read broker account databases or saved credential files.
- [x] **Step 4: Implement installer handoff validation.** Support a user-selected setup file and the official MetaQuotes download page. Launch the installer interactively and validate an empty target folder. Clean-copy remains unavailable because no recognized MT5 package layout could be validated to exclude roaming/account data; use the installer route.
- [x] **Step 5: Run focused tests** and document that simultaneous copies require different directories and that the universal Mkety connector does not guarantee every broker server is in the universal MT5 server list.
- [x] **Step 6: Commit** as `feat: discover and add isolated MT5 terminals`.

### Task 3: Add one supervised connector worker per profile

**Files:**
- Create: `mt5-connector/process_supervisor.py`
- Create: `mt5-connector/test_process_supervisor.py`
- Modify: `mt5-connector/mkety_mt5_connector.py`
- Modify: `mt5-connector/test_connector.py`
- Modify: `mt5-connector/test_multi_instance.py`

**Interfaces:**
- Produce `WorkerSpec(profile_id, terminal_path, config_path, ledger_path, status_path)`.
- Produce `ConnectorSupervisor.start(spec: WorkerSpec) -> int`, `ConnectorSupervisor.stop(profile_id: str) -> None`, `ConnectorSupervisor.status(profile_id: str) -> dict`.
- Worker CLI accepts `--worker`, `--terminal`, `--config`, `--ledger`, `--status-file`, and `--profile-id`. Existing `--token`, `--gateway`, `--reset`, and no-path auto-discovery behavior remain supported for legacy/operator use.
- Worker status JSON contains profile ID, state, terminal path, account/server/environment metadata, worker PID, `last_gateway_heartbeat_at`, and update timestamp; it contains no token or password. Write atomically.
- A gateway state is **connected** only after `auth_ok` and a recent `heartbeat_ack`; process alive alone is not connected. Stale threshold is three heartbeat intervals (60 seconds with the existing 20-second cadence).

- [x] **Step 1: Add failing worker tests** for status changes at auth success, heartbeat acknowledgement, disconnect, reconnect, and shutdown; assert no token or password is present in status JSON.
- [x] **Step 2: Add failing supervisor tests** for duplicate profile start, duplicate canonical terminal path, isolated worker args/paths, stop of only the requested connector worker, and stale PID handling.
- [x] **Step 3: Run** `python -m unittest discover -s mt5-connector -p 'test_*.py' -v`; confirm expected failures in the new supervisor tests while existing connector tests pass.
- [x] **Step 4: Add status callbacks to `MketyMt5Connector`** for auth, heartbeat acknowledgements, reconnect errors, and shutdown. Keep order command handling unchanged and do not call MT5 positions/orders for status.
- [x] **Step 5: Implement supervisor process lifecycle** with explicit terminal/config/ledger/status paths and a per-profile lock. On close, stop only its own workers and leave MT5 terminals and broker positions untouched.
- [x] **Step 6: Run focused connector tests**; confirm existing CLI and auto-discovery tests pass plus new worker/supervisor tests.
- [x] **Step 7: Commit** as `feat: supervise isolated MT5 connector workers`.

### Task 4: Build the manager onboarding and returning-user interface

**Files:**
- Create: `mt5-connector/manager_ui.py`
- Create: `mt5-connector/test_manager_ui.py`
- Modify: `mt5-connector/mkety_mt5_connector.py`
- Modify: `.github/workflows/mt5-connector-release.yml`

**Interfaces:**
- Produce `run_manager(app_data_dir: Path, supervisor: ConnectorSupervisor, catalog: TerminalCatalog) -> int`.
- Use Tkinter/stdlib for the initial GUI; do not add a background service or external GUI runtime dependency.
- First-run wizard offers **Connect one terminal** (default) or **Set up multiple terminals**. Returning screen shows saved profiles with distinct terminal/process/account/gateway states, a **Sync this account in Mkety** reminder/link when identity sync is pending, and an **Add another terminal** action. Mkety remains authoritative for whether identity sync is complete.
- Pairing form is attached to a selected profile. It accepts the existing Mkety token, confirms observed account/server/environment, then starts that profile's worker.
- The standard minimize control leaves the manager/workers running in the taskbar. Closing asks the user to stop its connector workers and exit or cancel; it never leaves unmanaged detached workers. A second launch focuses the existing manager window instead of starting duplicates.

- [x] **Step 1: Add failing view-model tests** for first-run one/multiple choice, saved-profile rendering, no-terminal install/browse route, selected-profile token assignment, no false dashboard-sync success, close/minimize behavior, and second-launch focus behavior. Extend the existing onboarding tests to confirm server-side identity/environment mismatch remains rejected.
- [x] **Step 2: Run** `python -m unittest discover -s mt5-connector -p 'test_manager_ui.py' -v`; confirm expected failures.
- [x] **Step 3: Implement Tkinter screens** using the profile store, terminal catalog, and supervisor interfaces. Keep discovery on-demand; status refresh polls local JSON at 3-second intervals and does not query broker positions/orders.
- [x] **Step 4: Preserve existing CLI entry behavior** when explicit CLI flags are supplied; double-click with no flags opens the manager. Legacy default config is surfaced as an existing profile without moving/resetting it. Keep `resolve_startup_config` prompting behavior for console/Python use; the windowed EXE manager owns interactive token entry.
- [x] **Step 5: Update PyInstaller packaging** to build the same universal one-file EXE in windowed mode, include Tkinter assets, and support both manager and hidden `--worker` modes. Keep smoke tests for the packaged headless worker mode and explicit CLI invocation.
- [x] **Step 6a: Run all Python connector tests** with `python -m unittest discover -s mt5-connector -p 'test_*.py' -v` and add the packaged headless worker smoke check to CI.
- [ ] **Step 6b: Manually exercise the packaged GUI, registry/process discovery and interactive installer on a Windows CI runner or controlled Windows machine.** This environment has no Windows runner or MT5 installation.
- [x] **Step 7: Commit** as `feat: add MT5 connector terminal manager UI`.

### Task 5: Add independent dashboard sync for multiple paired accounts

**Files:**
- Modify: `cloudflare-v2/src/dashboard_mt5_connector_connections.js`
- Modify: `cloudflare-v2/tests/mt5_connector_frontend.test.mjs`

**Interfaces:**
- Refactor the existing per-account `syncConnector(id, button)` so it returns a structured `{accountId, ok, account?, error?}` result while preserving its current button state and success/error messages.
- Add `syncPendingConnectors(accountIds)` to invoke the existing per-account sync endpoint sequentially, continue after a failure, and return one result per account.
- Add **Sync all pending identities** only for unsynchronized MT5 Connector account cards. It must not sync cTrader, MT5 Bridge, or already unrelated accounts.
- Point the connector download action to `https://github.com/MketyDigital/Trading/releases/latest/download/MketyMT5Connector.exe`, which continues to serve v1.0.0 until a later stable release is published.

- [x] **Step 1: Add failing frontend tests** for selection of only pending MT5 Connector cards, independent success/failure, duplicate-click protection, and stable latest asset URL.
- [x] **Step 2: Run** `node --test cloudflare-v2/tests/mt5_connector_frontend.test.mjs`; confirm the new tests fail.
- [x] **Step 3: Implement sequential batch sync using the existing account endpoint**; retain individual sync buttons and do not change API/server behavior.
- [x] **Step 4: Run the frontend test and connector onboarding tests** with `node --test cloudflare-v2/tests/mt5_connector_frontend.test.mjs cloudflare-v2/tests/mt5_connector_onboarding.test.mjs`.
- [x] **Step 5: Commit** as `feat: sync pending MT5 connector identities together`.

### Task 6: Make release validation version-safe and update customer instructions

**Files:**
- Modify: `.github/workflows/mt5-connector-release.yml`
- Modify: `mt5-connector/README.md`
- Test: `cloudflare-v2/tests/mt5_connector_release_contract.test.mjs`

- [x] **Step 1: Add failing release-contract tests** proving branch/PR builds cannot upload/clobber a release and a release upload requires a new `mt5-connector-v*` tag.
- [x] **Step 2: Run** `node --test cloudflare-v2/tests/mt5_connector_release_contract.test.mjs`; confirm expected failures.
- [x] **Step 3: Update release workflow** to keep PR/main pushes artifact-only, publish only from an explicitly versioned tag, and fail if that tag already exists instead of overwriting v1.0.0.
- [x] **Step 4: Update README** with novice first-run/multiple-terminal steps, legacy-profile upgrade, individual/batch dashboard sync, install-vs-clean-copy choices, status meanings, stop/restart behavior, and RAM guidance labeled as an estimate, not a guarantee. Record measured idle/peak memory for one, two, and three demo terminals on a Windows test VPS if available; do not claim 1 GB is sufficient without those measurements.
- [x] **Step 5: Run complete connector and release contract tests**: `python -m unittest discover -s mt5-connector -p 'test_*.py' -v` and `node --test cloudflare-v2/tests/mt5_connector_frontend.test.mjs cloudflare-v2/tests/mt5_connector_release_contract.test.mjs cloudflare-v2/tests/mt5_connector_onboarding.test.mjs`.
- [x] **Step 6a: Inspect the changed paths and verify no pending-order, cTrader, cBot, production secret, or deployment files changed.**
- [ ] **Step 6b: Validate the Windows build artifact in CI.** Do not publish a GitHub release or deploy the dashboard in this plan.
- [x] **Step 7: Commit** as `docs: document MT5 multi-terminal setup and safe release process`.

## Completion Gate

Implementation and local regression gates are complete. The Windows build/GUI gate remains open until CI produces the packaged artifact and the manager is exercised on Windows with MT5. User approval is required before publishing a new connector release or deploying the dashboard link/batch-sync UI.
