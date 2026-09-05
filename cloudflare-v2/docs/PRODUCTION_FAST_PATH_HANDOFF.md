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
- Workflow `Cloudflare Staging Gate`, run `33951878273`, job `101268094904`: **success**.
- Branch/head deployed: `design/enterprise-trading-event-core` at `c6dba590305bfc191b880fb7e15681bc81aa4997`.
- Paid runtime configuration, Cloudflare identity and Wrangler dry-run checks succeeded.
- Ephemeral secrets file was built, used, then removed successfully.
- Paid deployment succeeded; free deployment skipped.
- Runtime secrets injected: `SUPABASE_URL`, normalized Supabase service-role secret and `TRADING_MASTER_KEY` without intentional logging/commit.
- All four safety fuses remained false. No real-money execution enabled.

### Mkety signed Trading access boundary — IMPLEMENTED + GREEN
- New verifier: `src/security/mkety_access_assertion.js`.
- V1 admin authorization now uses Mkety-signed assertions rather than direct Zitadel organization/project-role authorization.
- Assertion checks RS256 signature/key, issuer, Trading audience, time validity, `sub`, `product=trading`, exact `workspace_id`, `access=owner`.
- Trading then checks exact enabled workspace membership in `trading_workspace_memberships`; workspace itself must exist and be enabled.
- Legacy Zitadel-specific fields remain compatibility-only, not V1 admin authorization authority.
- Readiness requires `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` only when `TRADING_ACCESS_ENABLED=true`.
- Integration regression at head `9ae56e57abcee77166570005ce4c28ada6da7c0a`, run `33952893071`, was caught before deployment and fixed without restoring Zitadel coupling.
- Runtime/test head `04cb56247e7275d42c67b283ad16ff756c72a9cb`, CI run `33953020087`: **success**.
- Exact identity-doc head `5a184fde3faccce9d9157a31d13a37f8fcf4e7cc`, CI run `33953060199`: **success**.
- Current branch head before this handoff correction: `bb986a4e09af40af3334f94ed59f2798c6739efe`, CI run `33953325178`: **success**.

### Central Mkety Auth Gateway direction — RECORDED, NOT A TRADING BLOCKER
- Current Mkety development authority is `MketyDigital/mksaas`; the legacy `MketyDigital/Mkety` repository is not the implementation source for new identity work.
- The approved direction is one central Cloudflare-hosted Mkety Auth Gateway for all Mkety products and enterprise applications.
- Zitadel remains behind Mkety as the identity provider; products consume Mkety-signed access assertions rather than depending directly on Zitadel-specific token/organization/project claim shapes.
- Recommendation is recorded in `MketyDigital/mksaas` at `docs/CENTRAL_MKETY_AUTH_GATEWAY_RECOMMENDATION.md`, commit `152d9125a0d9c4c7c5a39e8360108e679c4185ab`.
- Trading work continues independently. Do not implement a temporary Trading-specific identity issuer or direct-Zitadel fallback just to unblock staging.
- Until the central gateway exists, keep `TRADING_ACCESS_ENABLED=false`; Trading core/runtime can still be deployed and tested.

### Supabase
- Project `Mkety Digital` (`vdblajgxrfndjesoyayy`), URL `https://vdblajgxrfndjesoyayy.supabase.co`.
- Trading migrations applied/verified through `0012`.
- `trade_accounts.workspace_id` references `trading_workspace_access(id)` with `ON DELETE RESTRICT`.

### Cloudflare target / health
- Inspect run `33950342398`, job `101263798521`: success.
- `mkety-copier-engine` remains current staging/test Worker for this path, not automatically the final general-production target.
- Paid staging deployment success is verified.
- `/api/v1/health` response has not yet been independently captured because direct Workers.dev probing from the available web client was blocked before request execution. This is a tool limitation, not evidence of Worker failure. Verify through a Cloudflare/GitHub-safe curl path before external access enablement.

### Safety state
Still false:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

Staging currently runs the earlier safe core build. The newly GREEN Mkety-access code has not yet been redeployed. No real-money execution authorized.

## Exact next pickup
1. Redeploy the current GREEN Trading branch to the paid staging Worker with all four safety fuses false.
2. Verify `/api/v1/health` through the workflow/Cloudflare-safe path; the future Mkety access issuer/audience/JWKS may remain absent because access is disabled.
3. Continue non-auth Trading readiness that does not require external user access: default-domain/runtime verification, real Telegram source/destination acceptance, MT5 demo and cTrader demo connectivity, then one real E2E demo lifecycle.
4. When the central Mkety Auth Gateway is later available, configure `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` while access remains false; run positive/negative signed-access acceptance and prove Supabase workspace/membership revocation.
5. Only after access acceptance may `TRADING_ACCESS_ENABLED=true` be separately considered for staging. `BROKER_EXECUTION_ENABLED` remains false until its own later authorization.
6. Verify `trade.mkety.com` and one Cloudflare-for-SaaS custom hostname.
7. Run material recovery checks, shadow and demo soak.
8. Tiny live remains separately gated by explicit owner approval and exact financial limits.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading core depend directly on Zitadel.
- Do not authorize using reusable plain codes.
- Do not create one Zitadel project per enterprise customer.
- Do not create separate backend/workspace/identity per custom hostname.
- Do not implement new auth work in the legacy Mkety repository.
- Do not create a temporary Trading-only signer merely because central Mkety Auth is pending.
- Do not merge Trading runtime to `main` without explicit instruction.
- Do not enable real-money execution without separate explicit final approval.

## Continuation discipline
After every meaningful verified milestone, record exact branch head, CI/run/job evidence, environment changes actually performed, safety state, demonstrated defects/fixes and exact next pickup here and in `AGENTS.md` when controlling state changes.
