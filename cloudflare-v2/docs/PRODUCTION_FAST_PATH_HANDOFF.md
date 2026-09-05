# Mkety Trading – Production Fast Path Handoff

**Purpose:** Rolling continuation record. Read this first. `AGENTS.md` is the controlling operational source of truth; `PRODUCTION_V1_DEVELOPMENT_AUDIT.md` is historical evidence.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full workspace control.
- No complex team/department/role product for V1.
- Mkety uses Zitadel as the mother identity authority; Trading gets one Mkety Trading sub-project/application, not one per customer.
- Trading core/runtime remains independently deployable while external access is disabled.
- Mkety grants Trading access through a cryptographically signed, time-bounded entitlement/assertion derived from authenticated identity/product access; do not use a reusable plain access code.
- Supabase Trading workspace ownership is final application authorization.
- Trading-only customers do not need MKSaaS application access.
- Canonical entry point: `trade.mkety.com`.
- Optional verified customer hostname, e.g. `trade.starpipsforex.com`, via existing Cloudflare for SaaS.
- Default and custom hostnames resolve to the same internal workspace/backend.
- Hostname is routing context only and never authorization.

## Latest verified milestone — 2026-09-05

### Auth-adapter readiness refactor — GREEN
- RED test-only head: `0760480263dfdcbdc8deec9ef80adfab63f24ce7`.
- RED correctly demonstrated the old code still required Zitadel while `TRADING_ACCESS_ENABLED=false`.
- Minimal production-fix head: `b9bb16a789a0765a47fe768dd761a64ce1d5f12d`.
- Trading V1 CI run: `33951294621`.
- Test job: `101266508504`.
- Result: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all succeeded.
- Protected Cloudflare jobs remained skipped as intended.
- Core staging readiness now requires `SUPABASE_URL`, one supported Supabase service-role secret and `TRADING_MASTER_KEY` while Trading access is disabled.
- `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE` and `ZITADEL_JWKS_URL` are optional while `TRADING_ACCESS_ENABLED=false`.
- Those three Zitadel values become mandatory and fail closed when `TRADING_ACCESS_ENABLED=true`.

### Secure paid-staging runtime injection — READY FOR DISPATCH
- Design-branch workflow change: `bdb84f8e00f983d8d3da308c95e28d0ff292c1d4` (`ci: inject paid staging runtime secrets safely`).
- Default-branch workflow-only sync: `049d2060373425bbb2a0570579208d7ee9864283`.
- No Trading runtime/source/execution code was merged to `main`.
- `cloudflare-staging-gate.yml` now reads `SUPABASE_URL` from either the GitHub staging secret or environment variable form.
- It accepts Supabase service-role GitHub secrets named `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SERVICE_KEY`, and normalizes the chosen value to Worker runtime name `SUPABASE_SERVICE_ROLE`.
- It requires `TRADING_MASTER_KEY` by name before a paid deployment.
- It creates a mode-0600 ephemeral JSON secrets file inside `RUNNER_TEMP`, deploys with Wrangler `--secrets-file`, and deletes the temporary file with an `always()` cleanup step.
- Secret values are neither committed nor intentionally printed.
- Current Cloudflare documentation confirms `wrangler deploy --secrets-file` uploads secrets alongside the Worker code in the same controlled deployment; this avoids a separate `wrangler secret put`, which would itself create/deploy a Worker version.
- Ordinary Trading V1 CI intentionally excludes `.github/workflows/cloudflare-staging-gate.yml` from its path filters, so no separate ordinary CI run is expected solely for this workflow-plumbing commit. The underlying auth/runtime production head already passed GREEN CI above.

### Supabase / staging runtime configuration
- Supabase project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Project API URL: `https://vdblajgxrfndjesoyayy.supabase.co`.
- Trading migrations are applied and verified through `0012`.
- Owner confirmed `SUPABASE_URL` is present in GitHub environment `staging`.
- Owner confirmed `TRADING_MASTER_KEY` is present securely in GitHub environment `staging`.
- A Supabase service-role key was already reported present in GitHub environment `staging`.

### Cloudflare staging inspect — SUCCESS
- `Cloudflare Staging Gate` workflow run: `33950342398`.
- Job: `101263798521` (`staging-gate`).
- Mode: `inspect` on `design/enterprise-trading-event-core` at `d72531582f9ac843b47af0c7761e35566f00aae8`.
- Result: **success**.
- `wrangler whoami` authenticated to `Cloudflare@mkety.com's Account`.
- Paid and free Wrangler dry-runs succeeded.
- Paid deployment listing succeeded.
- Visible `mkety-copier-engine` history is pre-production acceptance activity (Gate 2/Gate 3 temporary uploads/rollbacks); no evidence of live customer production use was found.
- Treat `mkety-copier-engine` as the current staging/test Worker for this launch path, not automatically the final general-production target.
- `deploy-paid` and `deploy-free` were skipped; no deployment occurred in the inspect run.

### Zitadel
- Mkety Zitadel account/instance exists.
- No Mkety Trading sub-project/application exists yet.
- This no longer blocks core staging deployment while `TRADING_ACCESS_ENABLED=false`.
- Do not invent issuer/audience/JWKS/project values.

### Safety fuses
Remain false until the relevant explicitly authorized rollout step:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. In GitHub Actions open `Cloudflare Staging Gate`.
2. Run branch `design/enterprise-trading-event-core` with mode **`deploy-paid`**.
3. The workflow must fail before deployment if Cloudflare credentials, Supabase URL, an accepted service-role secret, or `TRADING_MASTER_KEY` are absent.
4. During deployment keep all four master fuses false.
5. After the run appears, inspect its exact job/logs here and confirm secret-file deployment succeeded without secret exposure.
6. Verify the staging Worker `/api/v1/health` reports core readiness; Zitadel may remain absent because access is disabled.
7. Create/configure the single Mkety Trading Zitadel sub-project/application and signed Mkety access-gate adapter.
8. Set `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE`, `ZITADEL_JWKS_URL` and preferably `ZITADEL_PROJECT_ID`; perform non-money-moving owner/workspace access acceptance before enabling Trading access.
9. Verify `trade.mkety.com`, then one optional customer hostname through Cloudflare for SaaS to the same workspace.
10. Connect real Telegram source/destination + MT5 demo + cTrader demo.
11. Run one real E2E demo lifecycle, material recovery checks, shadow and demo soak.
12. Tiny controlled live requires separate explicit owner approval with exact financial limits and kill/rollback procedure.

## Do not restart these debates
- Do not redesign Trading as a complex team/tenant SaaS.
- Do not make Trading core availability depend on Zitadel while access is disabled.
- Do not use a reusable plain code as the real authorization mechanism.
- Do not create a separate identity silo for Trading.
- Do not create one Zitadel project per enterprise customer.
- Do not create a separate backend per customer hostname.
- Do not add new gates/workflows/harnesses without a demonstrated blocker.
- Do not merge Trading runtime code into `main` without explicit owner instruction.
- Do not enable real-money execution without separate explicit final approval.

## Continuation discipline
After every meaningful verified milestone, update this file with exact branch head, CI/run/job evidence, environment changes actually performed, safety state, defects found/fixed and exact next pickup.
