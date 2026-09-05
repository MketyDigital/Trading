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
- Design-branch head used by the Cloudflare inspect run: `d72531582f9ac843b47af0c7761e35566f00aae8`.
- Ordinary CI run for that head: `33950037835`.
- Test job: `101262949497`.
- Result: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all succeeded.
- Protected Cloudflare jobs in ordinary CI remained skipped as intended.

### Supabase / staging runtime configuration
- Supabase project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Project API URL: `https://vdblajgxrfndjesoyayy.supabase.co`.
- Trading migrations are applied and verified through `0012`.
- Owner confirmed `SUPABASE_URL` is present in GitHub environment `staging`.
- Owner confirmed `TRADING_MASTER_KEY` is present securely in GitHub environment `staging`.
- A Supabase service-role key was already reported present in GitHub environment `staging`.
- Runtime accepts the service-role secret under one of: `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`.
- Core readiness still intentionally lacks Zitadel until the single `Mkety Trading` project/application is created: `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE`, `ZITADEL_JWKS_URL`.
- Do not invent/fake Zitadel values.

### Cloudflare staging inspect — SUCCESS
- `Cloudflare Staging Gate` workflow run: `33950342398`.
- Job: `101263798521` (`staging-gate`).
- Event: `workflow_dispatch` on `design/enterprise-trading-event-core` at head `d72531582f9ac843b47af0c7761e35566f00aae8`.
- Mode: `inspect`.
- Result: **success**.
- Branch guard passed.
- Required Cloudflare staging credential-name checks passed.
- `wrangler whoami` authenticated successfully to `Cloudflare@mkety.com's Account` using the configured Account API Token.
- Paid Wrangler profile dry-run succeeded.
- Free Wrangler profile dry-run succeeded.
- Paid dry-run showed expected bindings: MTProto listener DO, Trade State DO, MTProto Container DO, `mkety-trading-source-events` queue and all four launch master flags false.
- Free dry-run showed expected listener/Trade State DO bindings, `mkety-trading-source-events-free` queue and all four launch master flags false.
- The paid Worker deployment listing succeeded.
- The visible deployment history is pre-production acceptance activity from 2026-09-03: temporary uploads followed by `Gate 2 acceptance rollback` / `Gate 3 certificate probe rollback` entries.
- No evidence of a live customer/production deployment was present in the inspected history.
- For this launch path, `mkety-copier-engine` is therefore treated as the existing staging/test Worker. Do not assume this same target is the final general-production Worker without a later production-target decision.
- `deploy-paid` and `deploy-free` steps were skipped. No Cloudflare deployment occurred in this inspect run.
- Safety posture recorded by the workflow remained:
  - `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
  - `TRADINGVIEW_CERT_PROBE_ENABLED=false`
  - `TRADING_ACCESS_ENABLED=false`
  - `BROKER_EXECUTION_ENABLED=false`

### Cloudflare staging workflow exposure on default branch
- Root cause of the previously missing Actions UI entry was confirmed: `.github/workflows/cloudflare-staging-gate.yml` existed on `design/enterprise-trading-event-core` but not on default branch `main`.
- Owner explicitly authorized adding only this workflow file to `main`.
- No Trading runtime/source/execution code was merged to `main`.
- Workflow added to `main` in commit `8aef2dad4528a34d361823008b30e48c22a17f2d`.
- Workflow still contains the branch guard that refuses any run not targeting `design/enterprise-trading-event-core`.

### Cloudflare / runtime credentials known from owner
- `CLOUDFLARE_API_TOKEN` present in GitHub environment `staging` and proven usable by `wrangler whoami`.
- `CLOUDFLARE_ACCOUNT_ID` present in GitHub environment `staging`.
- `SUPABASE_URL` present in GitHub environment `staging`.
- Supabase service-role key present in GitHub environment `staging`.
- `TRADING_MASTER_KEY` present in GitHub environment `staging`.

### Zitadel
- Mkety Zitadel account/instance exists.
- No `Mkety Trading` project/application exists yet.
- Intended model: one shared-identity `Mkety Trading` project/application boundary; not one project per enterprise customer.
- Do not invent issuer/audience/JWKS/project values before this project/application is actually created.

### Safety fuses
Remain false until the relevant explicitly authorized rollout step:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. Re-fetch current design-branch head and require ordinary CI GREEN after this handoff-only commit.
2. Confirm the stored Supabase service-role secret uses one accepted runtime name (`SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SERVICE_KEY`).
3. Create/configure the single shared-identity `Mkety Trading` Zitadel project/application; then set `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE`, `ZITADEL_JWKS_URL` and preferably `ZITADEL_PROJECT_ID` in staging.
4. Once Zitadel values exist and the exact head is GREEN, explicitly authorize a staging deployment.
5. Run `Cloudflare Staging Gate` with `mode=deploy-paid` only; keep all four master fuses false.
6. Verify `/api/v1/health` exposes readiness/missing config names only and no secret material.
7. Verify non-money-moving Zitadel owner/workspace access.
8. Verify `trade.mkety.com`, then one optional customer hostname through Cloudflare for SaaS to the same workspace.
9. Connect real Telegram source/destination + MT5 demo + cTrader demo.
10. Run one real E2E demo lifecycle, material recovery checks, shadow and demo soak.
11. Tiny controlled live requires separate explicit owner approval with exact financial limits and kill/rollback procedure.

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
