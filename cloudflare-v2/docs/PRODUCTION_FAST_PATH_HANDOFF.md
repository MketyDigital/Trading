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

### Consolidated demo acceptance compatibility — FIXED + GREEN
- Demo command alias compatibility head: `b8d2a9fd5018d23c8435e53cdfb2feb3d7bc34c0`; CI run `33960604555`, job `101291723338`: **success**.
- `src/testing/mt5_demo_command.js` and `src/testing/ctrader_demo_command.js` accept `SUPABASE_SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`, or `SUPABASE_SERVICE_KEY` and normalize internally.
- A second TDD blocker was found in Gate 7: `.github/workflows/gate7-demo-destinations.yml` still injected/required only `SUPABASE_SERVICE_ROLE_KEY` even though staging may use the canonical alias.
- Gate 7 RED test commit: `79891bbd02cb1540156f027fe2b9f8155b95bce1`; Trading V1 CI run `33960876927`, job `101292427782`: **failure as expected** on the new workflow contract.
- Gate 7 production fix commit: `63c9e35ae681781a57c2badf73861567c473ecd6`.
- Exact verified GREEN test head: `471107aeb73070bb9855666b0d58f803fa2cac8d`; Trading V1 CI run `33960989322`, job `101292715706`: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all passed on the exact GREEN head.
- Both MT5 and cTrader Gate 7 jobs now accept all three service-role secret aliases, select the first configured value without printing it, mask it, and export only canonical runtime key `SUPABASE_SERVICE_ROLE`.
- Regression tests require both Gate 7 jobs to perform the normalization and require `BROKER_EXECUTION_ENABLED=false` in both demo lifecycle jobs.
- No external Telegram, MT5 or cTrader account was connected or contacted by these repo checks.

### External acceptance strategy — PRODUCTION PATH, MINIMAL REPEATED TESTING
- Do not create a second parallel implementation just for testing. When an external integration is connected, exercise the same production adapters and persistence boundaries intended for launch.
- Gate 5 MTProto is observation-only and keeps `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false`.
- Gate 6 MT5/cTrader connectivity probes keep order tests false and broker execution false; they prove credentials/account/server/API reachability without placing orders.
- Gate 6 real-source acceptance exercises source capture separately from destination execution.
- Gate 7 exercises DEMO destination lifecycle with explicit demo-account order tests while the global real-money broker execution fuse remains false.
- The goal is one meaningful acceptance per actual external system once connected, followed by one complete non-live E2E lifecycle and recovery/soak—not repeated architectural retesting.

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

No real-money execution authorized. The owner's request to prepare/live-test production paths does not override the separate requirement for exact financial limits before enabling money-moving broker execution.

## Exact next pickup
1. Treat the repo/config contract for MT5/cTrader demo acceptance as verified; do not repeat alias/naming tests unless the contract changes.
2. Continue preparing the real production integration surfaces so connecting Telegram, MT5 and cTrader later requires configuration rather than code redesign.
3. When actual external credentials/accounts are connected, run one production-path acceptance per integration: MTProto/source observation, MT5, cTrader; then one complete non-live E2E lifecycle and recovery/soak.
4. Do not enable `TRADING_ACCESS_ENABLED` until the central Mkety Auth Gateway signer/JWKS configuration exists; enabling it without its mandatory trust configuration would correctly fail readiness.
5. Do not enable `BROKER_EXECUTION_ENABLED` for real-money paths until explicit final approval includes exact financial limits/kill conditions. Demo lifecycle remains separately testable on confirmed demo accounts.
6. Later enable/test one custom hostname and signed-access path after their external dependencies are configured.
7. Merge Trading runtime to `main` only on explicit owner instruction.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading core depend directly on Zitadel.
- Do not authorize using reusable plain codes.
- Do not create one Zitadel project per enterprise customer.
- Do not create separate backend/workspace/identity per custom hostname.
- Do not implement new auth work in the legacy Mkety repository.
- Do not create a temporary Trading-only signer merely because central Mkety Auth is pending.
- Do not merge Trading runtime to `main` without explicit instruction.
- Do not enable real-money execution without separate explicit final approval with exact financial limits.

## Continuation discipline
After every meaningful verified milestone, record exact branch head, CI/run/job evidence, environment changes actually performed, safety state, demonstrated defects/fixes and exact next pickup here and in `AGENTS.md` when controlling state changes.
