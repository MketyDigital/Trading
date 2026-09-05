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

### Current paid staging deployment — SUCCESS
- Exact deployed branch/head: `design/enterprise-trading-event-core` at `ecb28b0e28709a6ac2bc778e78aa1fa77db0b41f`.
- Exact-head Trading V1 CI run `33955898330`, test job `101279074305`: **success**.
- Cloudflare Staging Gate `deploy-paid` run `33956116127`, job `101279663227`: **success**.
- Paid Worker: `mkety-copier-engine`.
- Deployed Worker version: `42e450f3-d801-45bb-a1af-5544233bded5`.
- Hidden runtime bindings include `SUPABASE_URL`, normalized `SUPABASE_SERVICE_ROLE`, and `TRADING_MASTER_KEY`; values were not intentionally logged or committed.
- Ephemeral staging secrets file was created with restricted permissions, used for deploy, then removed successfully.
- MTProto container image was updated with the same reviewed deployment.
- All five launch safety flags remained false; no custom-host routing, customer access, TradingView direct ingress or broker execution was enabled.

### Mkety signed Trading access boundary — IMPLEMENTED + GREEN + DEPLOYED DISABLED
- V1 admin uses `src/security/mkety_access_assertion.js`, not direct Zitadel organization/project-role authorization.
- Assertion checks RS256 signature/key, issuer, Trading audience, time validity, `sub`, `product=trading`, exact `workspace_id`, `access=owner`.
- Trading then checks exact enabled workspace membership in `trading_workspace_memberships`; workspace itself must exist and be enabled.
- Readiness requires `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` only when `TRADING_ACCESS_ENABLED=true`.
- Access remains globally disabled in staging; the future central Mkety Auth Gateway is not a core-runtime blocker.

### Custom hostname -> workspace boundary — CODE GREEN + DB APPLIED + DEPLOYED DISABLED
- Repo implementation head: `fb34a2fa187eeb66d6c74f54c81b5a75783525e1`.
- Trading V1 CI run `33955346608`, test job `101277576265`: **success**.
- Resolver/store: `src/security/trading_hostname_resolver.js`.
- Migration file: `db/migrations/0013_trading_workspace_hostnames.sql`.
- Migration applied to live Mkety Supabase as `20260905083908 trading_0013_workspace_hostnames`.
- Ledger, RLS, grants, FK, uniqueness, normalization/status checks and indexes verified after apply.
- `anon` SELECT: false; `authenticated` SELECT: false; `service_role` CRUD: true.
- Workspace FK is `trading_workspace_hostnames.workspace_id -> trading_workspace_access(id) ON DELETE CASCADE`.
- Tests cover hostname normalization, active mapping, unknown/pending/disabled fail-closed behavior, request-URL hostname authority over forwarded-host headers, canonical Mkety shared-host behavior, and custom-host/workspace mismatch rejection.
- `trade.mkety.com` remains a shared canonical entry and does not permanently preselect one customer workspace.
- Active customer custom hostnames resolve uniquely to one Trading workspace and must match the selected/authenticated workspace on `/api/v1/admin/*`.
- Customer hostname logic applies only to the enterprise admin/control surface; machine/source ingress such as `/api/v1/events` remains governed by source authentication and is not coupled to customer browser domains.
- The resolver code is present in the current paid staging Worker, but `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`; no DNS or Cloudflare-for-SaaS customer hostname has been enabled.

### Demo acceptance service-role compatibility — FIXED + GREEN, NOT DEPLOYED
- Latest repo head: `b8d2a9fd5018d23c8435e53cdfb2feb3d7bc34c0`.
- Trading V1 CI run `33960604555`, test job `101291723338`: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all passed.
- TDD RED head `753b1ffcc4329d41e2772f34cce0e2d54d106699` failed exactly four tests because MT5/cTrader demo command code hard-required `SUPABASE_SERVICE_ROLE_KEY`.
- `src/testing/mt5_demo_command.js` and `src/testing/ctrader_demo_command.js` now accept the same service-role aliases as staging: `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SERVICE_KEY`.
- Missing configuration reports the canonical `SUPABASE_SERVICE_ROLE` name without exposing secret values.
- Probe mode remains non-ordering and does not require the Supabase delivery store; lifecycle modes still use persistent delivery state.
- This compatibility change is repo-only at this checkpoint; the paid staging Worker remains the reviewed `ecb28b0e...` deployment because no runtime redeploy was authorized for this harness-only change.

### External non-live acceptance gates — READY, NOT RUN
- Gate 5 MTProto workflow is observation-only and forces `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false`.
- Gate 6 MT5 demo connectivity probe requires staging names `MT5_BRIDGE_URL`, `MT5_BRIDGE_SECRET`, `MT5_ACCOUNT_ID`, `MT5_EXPECTED_DEMO_SERVER`; it sets `MT5_DEMO_ACCEPTANCE_MODE=probe`, `MT5_DEMO_ORDER_TEST=false`, `BROKER_EXECUTION_ENABLED=false`.
- Gate 6 cTrader demo connectivity probe requires `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`, `CTRADER_ACCESS_TOKEN`, `CTRADER_ACCOUNT_ID`; it sets `CTRADER_DEMO_ACCEPTANCE_MODE=probe`, `CTRADER_DEMO_ORDER_TEST=false`, `BROKER_EXECUTION_ENABLED=false`.
- Real MT5/cTrader source acceptance is separately gated in `gate6-source-acceptance.yml`; it is not the same as connectivity probe and must not be triggered casually.
- No real Telegram, MT5, or cTrader external account was connected or probed during the repo-preparation milestone.

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
Still false in paid staging:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution authorized.

## Exact next pickup
1. Keep the paid staging Worker on the current safe deployment unless a new redeploy is explicitly authorized; the latest repo-only demo harness fix does not itself require runtime deployment for probe commands.
2. Before any external acceptance, confirm required staging secret/config names exist by name only; never print values.
3. With explicit authorization, run observation-only Gate 5 MTProto and/or Gate 6 MT5/cTrader connectivity probes first. These must keep order tests and broker execution OFF.
4. After connectivity is proven, separately authorize real source acceptance, then demo destination lifecycle acceptance. Do not combine these gates.
5. Build one complete non-live E2E signal lifecycle, then prove recovery/idempotency and run shadow/demo soak.
6. Later, under separate Cloudflare/domain authorization, add one staging/test customer hostname through Cloudflare for SaaS, insert/verify its mapping, and only then consider enabling custom-host routing for non-money-moving acceptance.
7. When central Mkety Auth Gateway exists, configure `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` with access still false and run signed-access positive/negative acceptance.
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
