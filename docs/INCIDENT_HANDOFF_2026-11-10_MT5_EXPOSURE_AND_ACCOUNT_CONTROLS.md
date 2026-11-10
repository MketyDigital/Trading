# Mkety Trading handoff — connected-account controls and FBS exposure (2026-11-10)

## Scope and safety

Repository: `MketyDigital/Trading`, baseline `main` after OCI read-only audit PRs #267–#270.
This handoff records an existing production incident; it does **not** authorize a LIVE order, replay, risk-policy bypass, credential rotation, or connector re-pairing. Preserve all saved connectors, pending orders, ledger state, and workspace/account authority.

## Frontend: first-panel account actions

- On 2026-11-09, the user reported that the first **Connected trading accounts** card no longer showed **Regenerate connection token** and the other account action buttons after the risk/sizing changes.
- Commit `4a59157edc54f5c38cc9285fd07b125c9861d13c` restored some generic account actions, but the first-panel function `accountButtons(x)` in `dashboard_simplified_account_controls.js` still omitted `Configure sizing`.
- MT5-specific token/sync actions were not part of `accountButtons(x)`; `dashboard_mt5_connector_connections.js` inserted them later through `attachSyncButtons()` and a DOM MutationObserver. This dependence made presence in the initial HTML/render path fragile.
- PR #271 renders MT5 `Regenerate connection token` and `Sync MT5 identity` / `Refresh MT5 connection` as stable buttons inside `accountButtons(x)`, restores `Configure sizing`, and attaches the existing handlers to those buttons after refresh. Legacy fallback insertion remains for compatibility. Non-MT5 cards do not get MT5 actions. Live permission gates and account sizing semantics are unchanged.
- Test: `cloudflare-v2/tests/connected_account_first_panel_actions.test.mjs`. Also run `production_dashboard_script_syntax.test.mjs`, `mt5_connector_frontend.test.mjs`, `demo_account_control_simplification.test.mjs`, and existing connected-account/UI tests.
- **Acceptance still required** after a successful reviewed merge: production Worker/frontend deploy proof, authenticated owner login to `trade.mkety.com`, visible MT5 token and sync buttons in FBS account `110664480` and another existing MT5 account, visible Configure sizing toggle, functioning Edit details and no duplicate controls after refresh. Do NOT click Regenerate token in acceptance without deliberate owner permission because it rotates real connection credentials. Test harmless page rendering/visibility before any write action.

## FBS exposure incident

- Source signal 2026-11-09 around 17:44 WAT, EURUSD BUY LIMIT; FBS live account row `5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51`, login `110664480`, server `FBS-Real`.
- FBS account active, execution-enabled, live-execution-enabled, `mt5_connector`, `lot_sizing_type=risk_percent`, `lot_value=50`, `lot_sizing_config={\"riskBasis\":\"balance\",\"riskMode\":\"fixed_cash\"}`.
- Operation journal FBS block code: `BROKER_EXPOSURE_PROVIDER_UNIMPLEMENTED`; no broker order ID for the FBS leg. Another independent destination had a registered broker order: do not replay the full source signal.
- PR #266 merged commit `a94013778aedfee29f373f362c32b2396102cead`, implementing broker-derived exposure context in Worker, gateway, Windows connector. Windows connector release `mt5-connector-v1.1.18` built and published from that commit in GitHub Actions run #42655240830.
- OCI Coolify production app `wp23orxgfa9py7giponnvcjt`, not stopped rollback app `p9xqtqpbljnggchy36mzd7a0`. Read-only deployment history audit #42767570921 showed deployment `7gokisxlxmigzvgrwvr1ooxg` to commit `a940137` finished 2026-11-09 16:16:32 UTC (17:16:32 WAT), before the 17:44 signal.
- **Current reproduced failure:** protected GitHub workflow run #42767956677 made an authenticated, GET-only `/v1/mt5-context/<FBS-row-id>?symbol=EURUSD&includeExposure=true` request; HTTP 200, `ok=true`, account row ID/login/server matched, but `context.exposure` absent. This reproduces the Worker rejection without trading.
- Likely unresolved seam: the running Windows connector process (possibly not actually restarted after v1.1.18 install) or the gateway container's active code. Published build and deployment history cannot alone prove actual running binary. On the VPS, inspect connector process path/start time and the executable's SHA256 versus release; stop/update/restart the FBS connector profile only after preserving pairing credentials/replay ledger. Then rerun `.github/workflows/oci-mt5-exposure-gateway-audit.yml` from main. Required result: `FBS_EXPOSURE_CHECK=PASS_AUTHENTICATED_BROKER_EXPOSURE`.
- Do not set transient fallback, report invented zero risk, relax protection policy or submit/recover LIVE broker actions to make this test green.

## Next-session stop/go

1. Confirm PR #271 CI pass and merge, then verify the **actual deployed** frontend and authenticated account panel visually; if buttons remain missing, inspect HTML enhancements, JS runtime exceptions, and network requests without rotating credentials.
2. Independently inspect the FBS Windows connector's running process and ensure v1.1.18 is actually serving context requests. Re-run protected GET-only workflow and inspect sanitized output.
3. Only once exposure is valid should non-executing fixed-$50 sizing tests and a separate authorized DEMO acceptance be considered. Keep the previous failed LIVE signal unreplayed.
