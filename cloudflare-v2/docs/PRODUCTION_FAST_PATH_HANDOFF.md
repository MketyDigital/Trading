# Mkety Trading – Production Fast Path Handoff

**Current classification:** `REPO GREEN / CODEQL SETTINGS BLOCKED / EXTERNAL STAGING ACCEPTANCE BLOCKED`  
**Repository:** `MketyDigital/Trading`  
**Active PR #6 branch:** `fix/v1-frontend-sync-simulation`  
**PR #6 base:** `design/enterprise-trading-event-core`  
**Draft PR:** #6 remains draft/open  

## Scope
This handoff is Trading-repo only. MkSaaS/Mkety is relevant only as the upstream auth/access assertion producer. Trading consumes the signed Mkety Trading assertion and then uses its own Supabase workspace/membership/application authority.

No MkSaaS repository changes are included here.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Trading consumes a signed Mkety Trading assertion and then verifies exact enabled workspace + exact enabled membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Repository tests may inject production gates and fake broker/provider dependencies as enabled. This does not create external connectivity or authorize real orders.

## PR #6 completion status
Approved plan:
- `docs/superpowers/plans/2026-09-06-v1-frontend-sync-simulation.md`

Audit matrix:
- `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`

Latest verified PR #6 head before this documentation update:
- `6da2232f666ae8129f9909f7604128a5e86e823d`

Trading V1 CI evidence for that SHA:
- Run: `34058536767`
- Job: `101554777002`
- Workflow conclusion: success
- `Run Worker and trading-core tests`: success
- `Run pure MT5 bridge tests`: success
- `Run pure MTProto Python tests`: success
- deployment/gate jobs: skipped unless explicitly configured for staging.

Documentation-only commits after that SHA update the handoff/plan/AGENTS and restore README to its original blob. Do not keep adding documentation-only commits just to chase CI; they will retrigger the same repository-level CodeQL default/advanced setup conflict until GitHub Code Security settings are fixed.

## Completed PR #6 tasks
1. Frontend contract guard.
2. V1 overview, members, sources, accounts and hostnames views.
3. Operations, event audit, risk/execution and truthful read-only settings.
4. Server-owned safe simulation adapter boundary.
5. Synthetic Mkety identity acceptance seam.
6. End-to-end synthetic source-to-destination acceptance.
7. Frontend/API/schema audit matrix.
8. Repo-controlled final verification, with CodeQL blocked by repository code-scanning configuration.

## Final verification status
Trading V1 CI is green on the latest verified PR #6 head listed above.

CodeQL verification status:
- A temporary advanced CodeQL workflow was added in `e5338458dfe04f98cc12b4c21de63c660356677a` to force fresh branch CodeQL evidence.
- GitHub rejected the uploaded SARIF because default setup is already enabled for the repository.
- The temporary workflow was removed in `a56e5a423b24e9b797757179dbd99bf4c11646d0`.
- GitHub default CodeQL still ran on the restored head and on `6da2232f666ae8129f9909f7604128a5e86e823d`.
- The latest default CodeQL run with complete logs reviewed is `34058536874`; both Python and JavaScript/TypeScript jobs failed with the same processing/configuration error: CodeQL analyses from advanced configurations cannot be processed when default setup is enabled.
- The fetched CodeQL logs show extraction/querying reached SARIF upload, then code-scanning processing rejected the upload as a configuration conflict. This is a repository Code Security setup blocker, not a confirmed runtime code vulnerability.

Required CodeQL admin action:
- In GitHub Code Security settings, select one CodeQL operating mode only: default setup or advanced setup.
- Clear the default-vs-advanced configuration conflict.
- Rerun CodeQL on PR #6.

Do not claim fresh CodeQL success on PR #6 until the repository CodeQL settings conflict is resolved and a new CodeQL run succeeds.

## Frontend/API/schema audit result
`cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md` records the current dashboard mapping:

- Protected dashboard calls use `/api/v1/admin/*` only.
- Browser requests include Mkety bearer token and `X-Mkety-Workspace-Id`.
- Workspace, members, sources, accounts, hostnames, operations and event-audit surfaces map to concrete V1 handlers.
- Generic browser DB proxy, legacy bot authorize shortcut, bank decision route, legacy signal webhook, fake settings save and browser-selected simulation are removed or blocked.
- Event audit is workspace-scoped and sanitized.
- Source/account secrets remain server-side and are not exposed in public responses.

## Current safety state
No production promotion happened in this workstream.

No real broker/provider credentials were added.

No real-money orders were placed.

No merge to `main` occurred.

Keep rollout fuses false until their corresponding acceptance/configuration gates are deliberately satisfied:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

## External staging acceptance remains blocked
The repo is ready for controlled staging preparation, but production promotion remains blocked until these non-code gates are satisfied:

1. Resolve the GitHub CodeQL default-vs-advanced configuration conflict and obtain fresh CodeQL success.
2. Configure Gate 4 Mkety access/identity acceptance values.
3. Configure Gate 5 dedicated non-production Telegram/MTProto source observation values.
4. Configure Gate 6 verified demo MT5/cTrader connectivity and source-only acceptance values.
5. Configure Gate 7 demo destination values only after independently confirming accounts are demo-only.
6. Confirm `main` branch protection or equivalent required-review/status-check policy.
7. Run staging acceptance gates with all real-money execution controls disabled unless a specific demo-only gate deliberately requires bounded demo orders.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading authorize directly from Zitadel claim shapes.
- Do not create a Trading-only signer.
- Do not use hostname as authorization.
- Do not use caller-supplied broker/account/workspace hints as authority.
- Do not resurrect the corrected destination-retry master-fuse false positive.
- Do not merge runtime to `main` or enable real-money execution without explicit instruction.
