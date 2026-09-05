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

## Current verified state — 2026-09-05

### Code / GitHub
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Last runtime/test GREEN head before documentation lock-in: `86c3991617bbe2a381106e8c3a62a6ecf135110b`
- Ordinary CI run: `33902795369`
- Test job: `101120562074`
- Result: success
- Protected Cloudflare jobs: skipped
- Gate 6 change was test-only; no runtime/source/execution behavior changed.

### Documentation lock-in commits
- Product model spec: commit `232b2f01b2c1080be52e19c0ab79dca76c2e63be`
- Minimal production plan: commit `745e0a7969ccf91406d0e8e5fd6e9dda68a5ecaf`
- Refreshed `AGENTS.md`: commit `1f855148af6d75a43657ec2a3354c94a2a1b6b95`
- Documentation-only commits may advance the branch beyond the last runtime GREEN head; verify exact-head ordinary CI before deployment.

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
1. Re-fetch current branch head.
2. Verify ordinary CI is GREEN on the documentation-updated exact head.
3. Run existing `.github/workflows/cloudflare-staging-gate.yml` in **`inspect` mode only**.
4. Confirm account identity, dry-runs, deployment listing and whether `mkety-copier-engine` is truly an isolated staging Worker.
5. Do not run `deploy-paid` or `deploy-free` unless staging target isolation is proven.
6. Complete minimum non-Zitadel staging runtime config by name: `SUPABASE_URL`, accepted Supabase service-role secret name, `TRADING_MASTER_KEY`.
7. Deploy staging with all master fuses off once target/config are safe.
8. Verify `/api/v1/health` exposes readiness/missing config names only and no secret material.
9. Create/configure the single shared-identity `Mkety Trading` Zitadel project/application; then perform non-money-moving auth/workspace acceptance.
10. Verify `trade.mkety.com`, then one optional test custom hostname through Cloudflare for SaaS to the same workspace.
11. Connect real Telegram source/destination + MT5 demo + cTrader demo.
12. Run one real E2E demo lifecycle, material recovery checks, shadow and demo soak.
13. Tiny controlled live requires a separate explicit owner approval with exact financial limits and kill/rollback procedure.

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