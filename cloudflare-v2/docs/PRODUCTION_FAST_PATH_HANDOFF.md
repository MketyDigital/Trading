# Mkety Trading – Production Fast Path Handoff

**Purpose:** Rolling continuation record. Read this first. `AGENTS.md` is controlling; the audit is historical evidence.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- No complex team/department product for V1.
- Mkety uses Zitadel as mother identity provider, but Trading does not directly depend on Zitadel org/project-role claim shapes.
- Mkety identity/product gate issues a short-lived signed Trading assertion.
- Trading verifies Mkety signature/issuer/audience/time + `product=trading` + exact `workspace_id` + `access=owner`, then verifies exact enabled workspace membership in Supabase.
- Supabase is final Trading application authorization/revocation authority.
- Trading-only customers do not need MKSaaS app/database access.
- Default entry `trade.mkety.com`; optional customer hostname via Cloudflare for SaaS maps to the same workspace/backend and never grants authorization.

## Latest verified milestone — 2026-09-05

### Paid Cloudflare staging deployment — SUCCESS
- Workflow: `Cloudflare Staging Gate`.
- Run: `33951878273`.
- Job: `101268094904` (`staging-gate`).
- Branch/head deployed: `design/enterprise-trading-event-core` at `c6dba590305bfc191b880fb7e15681bc81aa4997`.
- Paid runtime configuration name checks succeeded.
- Cloudflare identity and Wrangler dry-run checks succeeded.
- Ephemeral paid staging secrets file was built successfully, used for deployment, then removed successfully.
- Paid Worker deployment succeeded; free deployment was skipped.
- Runtime secrets injected: `SUPABASE_URL`, normalized Supabase service-role secret and `TRADING_MASTER_KEY`; values were not intentionally logged/committed.
- Safety remained fail closed:
  - `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
  - `TRADINGVIEW_CERT_PROBE_ENABLED=false`
  - `TRADING_ACCESS_ENABLED=false`
  - `BROKER_EXECUTION_ENABLED=false`
- No real-money execution was enabled.

### Mkety signed Trading access boundary — IMPLEMENTED + GREEN
- New verifier: `src/security/mkety_access_assertion.js`.
- V1 admin authorization now uses Mkety-signed assertions rather than direct Zitadel organization/project-role authorization.
- Signed assertion contract checks:
  - RS256 signature/key;
  - trusted issuer;
  - Trading audience;
  - time validity;
  - immutable `sub`;
  - `product=trading`;
  - exact requested `workspace_id`;
  - `access=owner`.
- After assertion verification, Trading independently checks exact enabled workspace membership in `trading_workspace_memberships`.
- Workspace must exist and have `trading_access_enabled=true`.
- Legacy Zitadel-specific fields remain only for compatibility and are not V1 admin authorization authority.
- Readiness now uses `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` only when `TRADING_ACCESS_ENABLED=true`.
- A real integration regression was caught before deployment at head `9ae56e57abcee77166570005ce4c28ada6da7c0a`, run `33952893071`; stale direct-Zitadel acceptance assumptions were then removed rather than reintroducing coupling.
- Runtime/test head `04cb56247e7275d42c67b283ad16ff756c72a9cb`: CI run `33953020087` **success**.
- Exact docs/current head before this handoff update: `5a184fde3faccce9d9157a31d13a37f8fcf4e7cc`: CI run `33953060199` **success**.
- Operator identity doc `docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md` now describes the Mkety-signed access boundary and Zitadel-behind-Mkety model.

### Supabase
- Project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- URL: `https://vdblajgxrfndjesoyayy.supabase.co`.
- Trading migrations applied/verified through `0012`.
- `trade_accounts.workspace_id` references `trading_workspace_access(id)` with `ON DELETE RESTRICT`.

### Cloudflare target
- Inspect run `33950342398`, job `101263798521`: success.
- Paid/free dry runs succeeded against Mkety Cloudflare account.
- `mkety-copier-engine` is treated as current staging/test Worker for this path; do not assume it is final general-production target.

### Health
- Paid staging deployment success is verified.
- `/api/v1/health` response has not yet been independently captured because the available direct web client rejected the Workers.dev URL before making the request. This is a tooling limitation, not evidence of Worker failure.
- Verify health through a Cloudflare/GitHub-safe curl path before external Trading access is enabled.

### Safety state
Still false:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

Staging currently runs the earlier safe core build. The newly GREEN Mkety-access code has not yet been redeployed. No real-money execution authorized.

## Exact next pickup
1. Discover the mother Mkety repository/service that currently owns Zitadel authentication/product access. Reuse it; do not create a parallel identity stack.
2. Implement or expose the smallest Mkety-side signed assertion issuer + JWKS endpoint for Trading. Claims: `sub`, `product=trading`, exact `workspace_id`, `access=owner`, `iss`, `aud`, `iat`, `exp`, `jti`.
3. Configure Trading staging with `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` while leaving `TRADING_ACCESS_ENABLED=false`.
4. Redeploy the GREEN Trading auth build with access/execution still OFF.
5. Verify `/api/v1/health` through the staging workflow/Cloudflare-safe path.
6. Run non-money-moving positive/negative signed-access acceptance and prove Supabase membership/workspace revocation.
7. Only after that may `TRADING_ACCESS_ENABLED` be explicitly considered for staging enablement. `BROKER_EXECUTION_ENABLED` remains false.
8. Verify `trade.mkety.com` then one optional Cloudflare-for-SaaS custom hostname.
9. Connect Telegram + MT5 demo + cTrader demo; run real E2E demo, recovery, shadow and demo soak.
10. Tiny live remains separately gated by explicit owner approval and exact financial limits.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading core depend directly on Zitadel.
- Do not authorize using reusable plain codes.
- Do not create one Zitadel project per enterprise customer.
- Do not create separate backend/workspace/identity per custom hostname.
- Do not merge Trading runtime to `main` without explicit instruction.
- Do not enable real-money execution without separate explicit final approval.

## Continuation discipline
After every meaningful verified milestone, record exact branch head, CI/run/job evidence, environment changes actually performed, safety state, demonstrated defects/fixes and exact next pickup here and in `AGENTS.md` when controlling state changes.
