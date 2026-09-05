# Mkety Trading – Production Fast Path Handoff

**Purpose:** This is the rolling continuation record. Read this first for current state. `AGENTS.md` is the controlling operational source of truth; `PRODUCTION_V1_DEVELOPMENT_AUDIT.md` is historical evidence.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full workspace control.
- No complex team/department/role product for V1.
- Shared mother Mkety Zitadel identity; Trading-only customers do not need MKSaaS application access.
- Trading runtime/data plane remains independent from MKSaaS.
- Canonical entry point: `trade.mkety.com`.
- Optional verified customer hostname, e.g. `trade.starpipsforex.com`, via existing Cloudflare for SaaS.
- Default and custom hostnames resolve to the same internal workspace/backend.
- Hostname is routing context only; Zitadel identifies the user and server-owned Trading data authorizes owner/workspace access.

## Latest verified milestone — 2026-09-05

### Exact-head ordinary CI GREEN
- Exact branch head verified before this handoff-only commit: `37ac515a84f508e2b1fec53a22b8dfca1d2c1741`.
- Ordinary CI run: `33948266614`.
- Test job: `101258156171`.
- Result: **success**.
- Worker/trading-core tests: success.
- Pure MT5 bridge tests: success.
- Pure MTProto Python tests: success.
- Protected jobs `cloudflare-inspect`, `cloudflare-inspect-gate3-zones`, `cloudflare-deploy-paid`, `cloudflare-probe-gate3-tradingview`, and `cloudflare-accept-gate2`: skipped as intended.
- The commits between runtime GREEN `86c3991617bbe2a381106e8c3a62a6ecf135110b` and `37ac515a84f508e2b1fec53a22b8dfca1d2c1741` are documentation-only product-model/plan/handoff changes.

### Supabase runtime facts
- Project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Project API URL verified from connected Supabase: `https://vdblajgxrfndjesoyayy.supabase.co`.
- Runtime readiness code accepts the service-role secret under any one of: `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`.
- Current required core readiness names in code are: `SUPABASE_URL`, one accepted Supabase service-role secret name, `TRADING_MASTER_KEY`, `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE`, `ZITADEL_JWKS_URL`.
- Do not invent/fake Zitadel values before the single `Mkety Trading` Zitadel project/application exists.

### Cloudflare inspection capability
- GitHub environment `staging` is reported by owner to contain `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and a Supabase service-role key.
- No direct Cloudflare connector/plugin is available in this ChatGPT session.
- The connected GitHub tool can inspect/rerun existing workflow runs but cannot dispatch a new `workflow_dispatch` run.
- Do not alter workflow triggers merely to work around this tool limitation.
- Therefore the next external action remains the existing staging workflow in **`inspect` mode only**; once that run exists, this session can inspect its jobs/logs and continue immediately.

## Current verified state

### Code / GitHub
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Last runtime/test GREEN head before documentation lock-in: `86c3991617bbe2a381106e8c3a62a6ecf135110b`
- Documentation-updated exact GREEN head before latest handoff-only commit: `37ac515a84f508e2b1fec53a22b8dfca1d2c1741`
- Ordinary CI run: `33948266614`
- Test job: `101258156171`
- Result: success
- Protected Cloudflare jobs: skipped
- Gate 6 change was test-only; no runtime/source/execution behavior changed.

### Documentation lock-in commits
- Product model spec: commit `232b2f01b2c1080be52e19c0ab79dca76c2e63be`
- Minimal production plan: commit `745e0a7969ccf91406d0e8e5fd6e9dda68a5ecaf`
- Refreshed `AGENTS.md`: commit `1f855148af6d75a43657ec2a3354c94a2a1b6b95`
- Rolling handoff creation: commit `37ac515a84f508e2b1fec53a22b8dfca1d2c1741`
- This file update is handoff-only; verify the resulting branch head/CI before any deployment action.

### Supabase
Project: `Mkety Digital`

Verified:
- project healthy;
- migrations through Trading `0010` were already recorded;
- `trading_0011_destination_delivery_retry_state` applied successfully;
- `trading_0012_trade_accounts_trading_workspace_fk` applied successfully;
- migration ledger now records through Trading `0012`;
- orphan `trade_accounts.workspace_id` prerequisite count = `0`;
- `trade_accounts.workspace_id` now references `trading_workspace_access(id)`;
- delete action = `ON DELETE RESTRICT`;
- `destination_deliveries` columns `next_attempt_at`, `lease_expires_at`, `last_attempt_at`, `failure_class` verified;
- `idx_destination_deliveries_retry_due` verified.

Pre-existing shared-project Supabase advisor findings were observed but not mutated because they are not part of the Trading fast-path migration step.

### Cloudflare
Known from owner:
- `CLOUDFLARE_API_TOKEN` stored in GitHub environment `staging`;
- `CLOUDFLARE_ACCOUNT_ID` stored in GitHub environment `staging`;
- Supabase service-role key stored in GitHub environment `staging`;
- existing Cloudflare for SaaS capability is available.

Not yet verified externally:
- whether Worker `mkety-copier-engine` is an isolated staging target;
- real `wrangler whoami`/deployment-list/dry-run output from staging environment;
- deployed application runtime secrets/config.

No Cloudflare deployment has been performed in this fast-path session.

### Zitadel
- Mkety Zitadel account/instance exists.
- No `Mkety Trading` project/application exists yet.
- Do not invent/fake issuer, audience, JWKS or project values.
- Intended model: one Mkety Trading project/application boundary sharing mother Mkety identity; not one Zitadel project per enterprise customer.

### Safety fuses
Remain false until the relevant explicit rollout step:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. Re-fetch current branch head and require ordinary CI GREEN after this handoff-only commit.
2. In GitHub Actions, run existing `.github/workflows/cloudflare-staging-gate.yml` on branch `design/enterprise-trading-event-core` with **mode = `inspect` only**.
3. Once the inspect run exists, fetch its jobs/logs here and confirm Cloudflare account identity, both Wrangler dry-runs, deployment listing and whether `mkety-copier-engine` is truly an isolated staging Worker.
4. Do not run `deploy-paid` or `deploy-free` unless staging target isolation is proven.
5. Add `SUPABASE_URL=https://vdblajgxrfndjesoyayy.supabase.co` to the staging runtime configuration if it is not already present.
6. Confirm the stored Supabase service-role key uses one accepted runtime name (`SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SERVICE_KEY`).
7. Generate/store `TRADING_MASTER_KEY` securely in staging; never commit or print the key.
8. Leave Zitadel readiness missing until the single `Mkety Trading` Zitadel project/application is created; never use placeholder issuer/audience/JWKS values.
9. After target identity is proven and minimum non-Zitadel config is present, deploy staging with all master fuses off and verify `/api/v1/health` exposes readiness/missing config names only.
10. Create/configure the single shared-identity `Mkety Trading` Zitadel project/application; then perform non-money-moving auth/workspace acceptance.
11. Verify `trade.mkety.com`, then one optional test custom hostname through Cloudflare for SaaS to the same workspace.
12. Connect real Telegram source/destination + MT5 demo + cTrader demo.
13. Run one real E2E demo lifecycle, material recovery checks, shadow and demo soak.
14. Tiny controlled live requires a separate explicit owner approval with exact financial limits and kill/rollback procedure.

## Do not restart these debates
- Do not redesign Trading as a complex team/tenant SaaS.
- Do not create a separate identity silo for Trading.
- Do not create one Zitadel project per enterprise customer.
- Do not create a separate backend per customer hostname.
- Do not add new gates/workflows/harnesses without a demonstrated blocker.
- Do not merge `main` without explicit owner instruction.
- Do not enable real-money execution without separate explicit final approval.

## Continuation discipline
After every meaningful verified milestone, append/update this file with:
- exact branch head;
- exact workflow/run/job when applicable;
- what passed/failed;
- external environment changes actually performed;
- safety fuse state;
- defects found/fixed;
- exact next pickup.

A newer verified entry here supersedes stale historical blocker text elsewhere.