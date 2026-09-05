# Mkety Trading – Production Fast Path Handoff

**Purpose:** Rolling continuation record. Read this first. `AGENTS.md` is the controlling operational source of truth; `PRODUCTION_V1_DEVELOPMENT_AUDIT.md` is historical evidence.

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
- Exact design-branch head before the latest handoff-only commit: `97a3464770ff22c8f3d2ad129290b1041f4d6fcf`.
- Ordinary CI run: `33948583488`.
- Result: **success**.
- Branch: `design/enterprise-trading-event-core`.
- Protected Cloudflare jobs remained skipped as intended.

### Supabase / staging runtime configuration
- Supabase project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Project API URL: `https://vdblajgxrfndjesoyayy.supabase.co`.
- Trading migrations are applied and verified through `0012`.
- Owner confirmed `SUPABASE_URL` has been added to GitHub environment `staging`.
- Owner confirmed `TRADING_MASTER_KEY` has been generated and added securely to GitHub environment `staging`.
- A Supabase service-role key was already reported present in GitHub environment `staging`.
- Runtime accepts the service-role secret under one of: `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`.
- Core readiness still intentionally lacks Zitadel until the single `Mkety Trading` project/application is created: `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE`, `ZITADEL_JWKS_URL`.
- Do not invent/fake Zitadel values.

### Cloudflare staging workflow now exposed on default branch
- Root cause of missing Actions UI entry was confirmed: `.github/workflows/cloudflare-staging-gate.yml` existed on `design/enterprise-trading-event-core` but not on default branch `main`.
- Owner explicitly authorized adding only this workflow file to `main`.
- No Trading runtime/source/execution code was merged to `main`.
- Workflow added to `main` in commit `8aef2dad4528a34d361823008b30e48c22a17f2d`.
- File presence on `main` was verified after the commit.
- Workflow still contains the branch guard that refuses any run not targeting `design/enterprise-trading-event-core`.
- Workflow default action remains `inspect`; deployment modes remain separate choices.
- No Cloudflare workflow run or deployment has been performed yet.

### Cloudflare staging credentials known from owner
- `CLOUDFLARE_API_TOKEN` present in GitHub environment `staging`.
- `CLOUDFLARE_ACCOUNT_ID` present in GitHub environment `staging`.
- `SUPABASE_URL` present in GitHub environment `staging`.
- Supabase service-role key present in GitHub environment `staging`.
- `TRADING_MASTER_KEY` present in GitHub environment `staging`.

### Zitadel
- Mkety Zitadel account/instance exists.
- No `Mkety Trading` project/application exists yet.
- Intended model: one shared-identity `Mkety Trading` project/application boundary; not one project per enterprise customer.

### Safety fuses
Remain false until the relevant explicitly authorized rollout step:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. In GitHub Actions, open `Cloudflare Staging Gate`.
2. Click `Run workflow`.
3. Select branch `design/enterprise-trading-event-core`.
4. Leave mode as **`inspect`** only.
5. Start the workflow.
6. Once the run exists, inspect its jobs/logs here: `wrangler whoami`, paid/free Wrangler dry-runs, deployment listing and whether `mkety-copier-engine` is truly an isolated staging Worker.
7. Do not run `deploy-paid` or `deploy-free` until staging target isolation is proven.
8. Confirm the stored Supabase service-role secret uses one accepted runtime name.
9. Create/configure the single shared-identity `Mkety Trading` Zitadel project/application; then set issuer/audience/JWKS/project configuration.
10. Deploy staging with all master fuses off and verify `/api/v1/health` exposes readiness/missing config names only.
11. Verify `trade.mkety.com`, then one optional customer hostname through Cloudflare for SaaS to the same workspace.
12. Connect real Telegram source/destination + MT5 demo + cTrader demo.
13. Run one real E2E demo lifecycle, material recovery checks, shadow and demo soak.
14. Tiny controlled live requires separate explicit owner approval with exact financial limits and kill/rollback procedure.

## Do not restart these debates
- Do not redesign Trading as a complex team/tenant SaaS.
- Do not create a separate identity silo for Trading.
- Do not create one Zitadel project per enterprise customer.
- Do not create a separate backend per customer hostname.
- Do not add new gates/workflows/harnesses without a demonstrated blocker.
- Do not merge Trading runtime code into `main` without explicit owner instruction.
- Do not enable real-money execution without separate explicit final approval.

## Continuation discipline
After every meaningful verified milestone, update this file with exact branch head, CI/run/job evidence, environment changes actually performed, safety state, defects found/fixed and exact next pickup.
