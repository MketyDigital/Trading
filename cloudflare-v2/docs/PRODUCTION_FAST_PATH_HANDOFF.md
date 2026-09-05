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
- Exact-head Trading V1 CI run `33954207612`, test job `101274434754`: **success**.
- Cloudflare Staging Gate `deploy-paid` run `33954946800`, job `101276450948`: **success**.
- Paid Worker: `mkety-copier-engine`.
- Deployed Worker version: `b05e5134-17b6-42a6-af98-425b382c1e46`.
- Hidden runtime bindings include `SUPABASE_URL`, normalized `SUPABASE_SERVICE_ROLE`, and `TRADING_MASTER_KEY`; values were not intentionally logged or committed.
- Ephemeral staging secrets file was created with restricted permissions, used for deploy, then removed successfully.
- All four launch safety fuses remained false; no real-money execution was enabled.

### Mkety signed Trading access boundary — IMPLEMENTED + GREEN + DEPLOYED DISABLED
- V1 admin uses `src/security/mkety_access_assertion.js`, not direct Zitadel organization/project-role authorization.
- Assertion checks RS256 signature/key, issuer, Trading audience, time validity, `sub`, `product=trading`, exact `workspace_id`, `access=owner`.
- Trading then checks exact enabled workspace membership in `trading_workspace_memberships`; workspace itself must exist and be enabled.
- Readiness requires `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` only when `TRADING_ACCESS_ENABLED=true`.
- Access remains globally disabled in staging; the future central Mkety Auth Gateway is not a core-runtime blocker.

### Custom hostname -> workspace boundary — CODE GREEN + DB APPLIED
- Repo implementation head: `fb34a2fa187eeb66d6c74f54c81b5a75783525e1`.
- Trading V1 CI run `33955346608`, test job `101277576265`: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all passed; protected external/deploy jobs remained skipped.
- Resolver/store: `src/security/trading_hostname_resolver.js`.
- Migration file: `db/migrations/0013_trading_workspace_hostnames.sql`.
- Migration applied to live Mkety Supabase as `20260905083908 trading_0013_workspace_hostnames`.
- Ledger, RLS, grants, FK, uniqueness, normalization/status checks and indexes verified after apply.
- `anon` SELECT: false; `authenticated` SELECT: false; `service_role` CRUD: true.
- Workspace FK is `trading_workspace_hostnames.workspace_id -> trading_workspace_access(id) ON DELETE CASCADE`.
- New tests cover hostname normalization, active mapping, unknown/pending/disabled fail-closed behavior, request-URL hostname authority over forwarded-host headers, canonical Mkety shared-host behavior, and custom-host/workspace mismatch rejection.
- `trade.mkety.com` remains a shared canonical entry and does not permanently preselect one customer workspace.
- Active customer custom hostnames resolve uniquely to one Trading workspace and must match the selected/authenticated workspace on `/api/v1/admin/*`.
- Customer hostname logic applies only to the enterprise admin/control surface; machine/source ingress such as `/api/v1/events` remains governed by source authentication and is not coupled to customer browser domains.
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false` remains explicit. No DNS, Cloudflare-for-SaaS hostname, or deployed custom-host behavior has been enabled yet.

### Post-0013 advisor state
- Security advisor: the new Trading hostname table reports expected INFO `rls_enabled_no_policy` because it is intentionally service-role-only with anon/authenticated privileges revoked.
- No new Trading-specific WARN blocker appeared after migration 0013.
- Existing project-wide WARNs remain: `vector` extension in `public`; shared `public.rls_auto_enable()` SECURITY DEFINER executable by anon/authenticated. These pre-date migration 0013 and were not altered under Trading scope.
- Performance advisor reports the new hostname workspace/status index as unused, expected immediately after creation; no unindexed FK warning was raised for `trading_workspace_hostnames`.
- Shared/project-wide unrelated advisor findings remain out of Trading scope unless separately authorized.

### Central Mkety Auth Gateway direction — RECORDED, NOT A TRADING BLOCKER
- Current Mkety development authority is `MketyDigital/mksaas`.
- Direction: one central Cloudflare-hosted Mkety Auth Gateway for all Mkety products/enterprise applications, with Zitadel behind Mkety and signed product assertions at the boundary.
- Recommendation: `MketyDigital/mksaas/docs/CENTRAL_MKETY_AUTH_GATEWAY_RECOMMENDATION.md`, commit `152d9125a0d9c4c7c5a39e8360108e679c4185ab`.
- Do not implement a temporary Trading-specific signer or direct-Zitadel fallback.

### Health caveat
- `/api/v1/health` is exposed independently of Trading access.
- An HTTP response body from Workers.dev has not been independently captured because the available web client blocks direct `workers.dev` URLs before sending the request. This is a tooling limitation, not evidence of Worker failure.
- Do not claim HTTP health acceptance until an actual response is captured through an approved path.

## Safety state
Still false:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. Redeploy the latest GREEN Trading branch so the deployed Worker includes the hostname resolver code while all access/execution/custom-host flags remain false.
2. Verify `/api/v1/health` through a GitHub/Cloudflare-safe path if possible.
3. Keep `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`, `TRADING_ACCESS_ENABLED=false`, and `BROKER_EXECUTION_ENABLED=false` after redeploy.
4. Later, under separate Cloudflare/domain authorization, add one staging/test customer hostname through Cloudflare for SaaS, insert/verify its mapping, and only then consider enabling custom-host routing for non-money-moving acceptance.
5. When central Mkety Auth Gateway exists, configure `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` with access still false and run signed-access positive/negative acceptance.
6. Continue Telegram source/destination + MT5 demo + cTrader demo, one real E2E demo lifecycle, recovery, shadow and demo soak.
7. Tiny live remains separately gated by explicit owner approval and exact financial limits.

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
