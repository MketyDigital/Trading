# Mkety Trading – Production Fast Path Handoff

**Purpose:** Rolling continuation record. Read this first. `AGENTS.md` is controlling; the audit is historical evidence.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- No complex team/department product for V1.
- Zitadel is behind Mkety identity; Trading does not directly depend on Zitadel org/project-role claim shapes.
- Mkety identity/product gate issues a short-lived signed Trading assertion.
- Trading verifies Mkety signature/issuer/audience/time + `product=trading` + exact `workspace_id` + `access=owner`, then verifies exact enabled workspace membership in Supabase.
- Supabase is final Trading application authorization/revocation authority.
- Trading-only customers do not need MKSaaS app/database access.
- Default entry `trade.mkety.com`; optional customer hostname via Cloudflare for SaaS maps to the same workspace/backend and never grants authorization.

## Latest verified milestone — 2026-09-05

### Current signed-access build deployed to paid staging — SUCCESS
- Exact deployed branch/head: `design/enterprise-trading-event-core` at `1d0a12f0b8ab24e112a4062bf87725ef050b4bf2`.
- Exact-head Trading V1 CI run `33954207612`, test job `101274434754`: **success**; Worker/trading-core, pure MT5 and pure MTProto tests all passed.
- Cloudflare Staging Gate `deploy-paid` run `33954946800`, job `101276450948`: **success**.
- Paid Worker: `mkety-copier-engine`.
- Deployed Cloudflare Worker version: `b05e5134-17b6-42a6-af98-425b382c1e46`.
- Runtime secrets `SUPABASE_URL`, normalized `SUPABASE_SERVICE_ROLE`, and `TRADING_MASTER_KEY` were present as hidden bindings; values were not intentionally logged or committed.
- Ephemeral staging secrets file was created with restricted permissions, used for deploy, then removed successfully.
- Paid/free Wrangler dry-runs and Cloudflare identity checks succeeded.
- All four safety fuses remained false:
  - `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
  - `TRADINGVIEW_CERT_PROBE_ENABLED=false`
  - `TRADING_ACCESS_ENABLED=false`
  - `BROKER_EXECUTION_ENABLED=false`
- No real-money execution was enabled.

### Mkety signed Trading access boundary — IMPLEMENTED + GREEN + DEPLOYED DISABLED
- Verifier: `src/security/mkety_access_assertion.js`.
- V1 admin authorization uses Mkety-signed assertions rather than direct Zitadel organization/project-role authorization.
- Assertion checks RS256 signature/key, issuer, Trading audience, time validity, `sub`, `product=trading`, exact `workspace_id`, `access=owner`.
- Trading then checks exact enabled workspace membership in `trading_workspace_memberships`; workspace itself must exist and be enabled.
- Legacy Zitadel-specific fields remain compatibility-only, not V1 admin authorization authority.
- Readiness requires `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` only when `TRADING_ACCESS_ENABLED=true`.
- Access remains globally disabled in deployed staging, so the future central Mkety Auth Gateway is not a core-runtime blocker.

### Central Mkety Auth Gateway direction — RECORDED, NOT A TRADING BLOCKER
- Current Mkety development authority is `MketyDigital/mksaas`; the legacy `MketyDigital/Mkety` repository is not the implementation source for new identity work.
- Direction: one central Cloudflare-hosted Mkety Auth Gateway for all Mkety products/enterprise applications, with Zitadel behind Mkety and signed product assertions at the boundary.
- Recommendation is recorded in `MketyDigital/mksaas` at `docs/CENTRAL_MKETY_AUTH_GATEWAY_RECOMMENDATION.md`, commit `152d9125a0d9c4c7c5a39e8360108e679c4185ab`.
- Do not implement a temporary Trading-specific signer or direct-Zitadel fallback.

### Supabase
- Project `Mkety Digital` (`vdblajgxrfndjesoyayy`), URL `https://vdblajgxrfndjesoyayy.supabase.co`.
- Trading migrations applied/verified through `0012`.
- `trade_accounts.workspace_id` references `trading_workspace_access(id)` with `ON DELETE RESTRICT`.
- Existing Trading access/membership tables have service-role Data API grants and no anon/authenticated table grants in the inspected role-grant set.

### Hostname/runtime finding
- The approved custom-domain model is documented but there is currently no hostname -> Trading workspace resolver in runtime code.
- `trade.mkety.com` is the shared canonical entry point and must not be permanently mapped to one enterprise customer; the authenticated Mkety assertion selects the workspace there.
- Only verified customer hostnames require a unique server-side hostname -> workspace mapping.
- Unknown, pending, disabled or wrong-workspace customer hostnames must fail closed once customer-host routing is used.
- Hostname context is routing scope only; it never replaces signed Mkety identity or Supabase authorization.

### Health caveat
- The deployed Worker exposes `/api/v1/health` independent of external Trading access.
- An HTTP response body from the Workers.dev health URL has not been independently captured because the available web client blocks direct `workers.dev` URLs before sending the request. This is a tooling limitation, not evidence of Worker failure.
- Do not claim HTTP health acceptance until an actual response is captured through an approved path.

## Safety state
Still false:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. Implement the already-approved hostname routing boundary in Trading, TDD-first, without touching live DNS/Cloudflare for SaaS yet.
2. Add a Trading-owned custom-hostname mapping schema/store: canonical `trade.mkety.com` remains shared; active verified customer hostnames resolve uniquely to a workspace; unknown/pending/disabled mappings fail closed.
3. Ensure runtime uses the URL hostname, not arbitrary forwarded-host headers, and requires a custom-host workspace to match the authenticated Mkety assertion workspace before allowing customer-facing V1 APIs.
4. Keep access/execution flags false throughout code/DB preparation.
5. Apply the hostname migration to live Supabase only under explicit authorization, then configure one staging/test Cloudflare-for-SaaS hostname separately under explicit authorization.
6. When central Mkety Auth Gateway exists, configure `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` with access still false and run non-money-moving signed-access acceptance.
7. Continue Telegram source/destination + MT5 demo + cTrader demo, one real E2E demo lifecycle, recovery, shadow and demo soak.
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
