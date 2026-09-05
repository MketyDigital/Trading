# Mkety Trading – Production Fast Path Handoff

**Purpose:** rolling continuation record. Read this together with repository-root `AGENTS.md`.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading is an independent runtime/data plane inside the Mkety ecosystem.
- Zitadel proves identity behind Mkety; the future central Mkety Auth Gateway issues short-lived signed Trading assertions.
- Trading verifies the Mkety assertion and then exact enabled workspace membership in Trading Supabase. Supabase remains final Trading authorization/revocation authority.
- Canonical entry is `trade.mkety.com`; optional customer hostnames are routing context only and never authorization.

## Latest verified milestone — 2026-09-05

### Production source onboarding — ALL APPROVED FAMILIES CODE GREEN
- Exact TradingView + Custom Signed API onboarding head: `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`.
- Trading V1 CI run `33992264387`, test job `101376473506`: **success**.
- Admin self-service source creation now covers every currently approved source family:
  - Telegram/MTProto providers -> typed `mtproto` encrypted credential envelope;
  - MT5 source bridge -> typed `mt5` encrypted credential envelope;
  - cTrader source -> typed `ctrader` encrypted credential envelope;
  - TradingView webhook -> server-generated public source handle with no fake broker/session credentials;
  - Custom Signed API -> server-generated ingress signing secret with no broker/session credentials.
- TradingView source creation is exact-workspace scoped, starts disabled, persists a server-generated `public_source_handle`, and exposes only the safe `/api/v1/webhooks/tradingview/<handle>` path. This milestone does not change the existing TradingView mTLS ingress/certificate security path.
- Custom Signed API source creation is exact-workspace scoped and starts disabled. A strong plaintext signing secret is generated server-side, only its encrypted form is persisted in `source_connections.secret_ciphertext`, and the plaintext is returned once at creation only.
- Custom Signed API secret rotation first resolves the exact persisted workspace/source, generates and persists an encrypted replacement in `secret_ciphertext`, and returns the replacement plaintext once. GET/list responses expose neither plaintext nor ciphertext signing secrets.
- Credential-based providers continue to store encrypted provider/session material separately in `source_connections.provider_secret_ciphertext`; the two security systems remain intentionally separate.
- All new sources remain inactive by default and source onboarding grants no broker execution authority.
- The bounded RED checkpoint had exactly three failures: TradingView create, Custom Signed API create and Custom Signed API secret rotation. The approved patch made those cases green without schema, custom-hostname, broker-execution, deployment or external-provider changes.
- Customer custom-hostname self-service provisioning/verification remains intentionally outside this milestone and is the next separate product gap.

### Production broker onboarding — CODE GREEN + LIVE DB READY
- Production broker onboarding code head: `d852de184c0b156dc360c4d242569b756acc2225`.
- Trading V1 CI run `33964408888`, test job `101301829090`: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all passed.
- Production admin account surface supports:
  - `POST /api/v1/admin/accounts`
  - `PUT /api/v1/admin/accounts/{id}/credentials`
- MT5/cTrader credentials are validated using the existing provider-specific credential contract.
- Credential material is encrypted server-side with `TRADING_MASTER_KEY` and stored only in `trade_accounts.credential_ciphertext`.
- Plaintext/ciphertext credentials are not returned through public/admin account responses.
- Credential rotation is exact-workspace scoped and changes only the encrypted credential envelope.
- New account creation is forcibly safe regardless of request hints: inactive, execution disabled, kill switch enabled.
- No account onboarding path may enable Worker-wide broker execution.

### Supabase migration 0014 — APPLIED + VERIFIED
- Repo migration: `cloudflare-v2/db/migrations/0014_trading_connection_credentials.sql`.
- Live project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Applied migration ledger entry: `20260905115452 trading_0014_connection_credentials`.
- Live column verified: `public.trade_accounts.credential_ciphertext text`, nullable.
- Column comment verified: encrypted broker/provider credential envelope, decrypt server-side only, never expose through client/admin responses.
- `trade_accounts` RLS remains enabled.
- Among inspected API roles, `anon` and `authenticated` have no table privileges; `service_role` retains server-side privileges.
- Security advisor after apply: no new Trading-specific WARN blocker. `trade_accounts` reports the expected INFO `rls_enabled_no_policy` because the table is intentionally service-role-only.
- Existing unrelated project WARNs remain unchanged: `vector` extension in `public`; shared `public.rls_auto_enable()` SECURITY DEFINER executable by anon/authenticated.
- Performance advisor after apply: no new `0014`-specific blocker; findings are existing project-wide INFO/WARN items.

### Current paid staging deployment — REDEPLOYED + HEALTH VERIFIED
- Paid Worker: `mkety-copier-engine`.
- Deployment trigger head: `6f291aebe85857a4fa521ae48c32a712d8b1662e` (`cloudflare: deploy paid staging gate 2`).
- Underlying verified MTProto callback config head: `a784d4b218a23418abf6390a123a6010e1487e33`.
- Deployment workflow run `33988612981`:
  - mandatory test job `101366660837`: **success**;
  - paid deploy job `101366757603`: **success**.
- Current Worker version: `68998f7f-74ce-4c37-8887-3751d3e17489`.
- Worker URL: `https://mkety-copier-engine.dry-glitter-7e16.workers.dev`.
- Paid runtime now includes non-secret `MTPROTO_INTERNAL_SOURCE_URL` targeting the first-party internal source-event endpoint.
- MTProto container application `a03c0bd0-3dab-4578-bab2-88bf5d0d7c1f` is `ready`; post-deploy inventory reported 7 live instances.
- Current MTProto container image digest: `sha256:be00f898cbe6c4b0ef614d31dc4b44efd151df38938a54cad47e312a18171ab4`.
- Source-event queue remains present with one producer and one consumer; DLQ remains present.
- Read-only deployed health probe run `33988725753`, job `101366975652`: **success**.
- Actual `/api/v1/health` response after redeploy: HTTP `200`, `ok:true`, `status:"ready"`, `ready:true`, `simulationReady:true`, `mtprotoContainerReady:true`, `missing:[]`, `mtprotoContainerMissing:[]`.
- Optional Mkety access signer config is still absent by design: `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL`; `TRADING_ACCESS_ENABLED` remains false.
- Hidden runtime bindings include `SUPABASE_URL`, normalized `SUPABASE_SERVICE_ROLE`, `TRADING_MASTER_KEY`, and the internal MTProto transport secret; secret values were not intentionally logged or committed.
- The newer source-onboarding head `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d` has not been deployed by this repository-only milestone.

### Other already-verified boundaries
- Mkety signed Trading assertion verifier is implemented and fail-closed; `TRADING_ACCESS_ENABLED` remains false.
- Custom hostname -> workspace resolver is implemented; migration `0013` is live; `TRADING_CUSTOM_HOSTNAMES_ENABLED` remains false. Customer hostname provisioning/verification remains a separate pending product subproject.
- MT5/cTrader demo acceptance workflows support all accepted service-role secret aliases and keep global broker execution false.
- External Telegram/MT5/cTrader/TradingView acceptance has not yet been performed with real external credentials/accounts/certificates in this milestone.

## Safety state
Keep false unless a separately authorized rollout step changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution is authorized. Real-money enablement still requires separate explicit owner approval with exact financial limits, kill conditions and rollback procedure.

## Exact next pickup
1. Treat self-service onboarding for all currently approved source families as code-green; do not redesign it.
2. Keep customer custom-hostname provisioning/verification as the next separate bounded product subproject; preserve hostname as routing context only, never authorization.
3. Keep **offline readiness** distinct from **external connectivity acceptance**:
   - offline readiness proves provider/family configuration, encrypted credential/signing-secret presence/decryptability and safe inactive state without network calls;
   - actual Telegram/MT5/cTrader connectivity and TradingView mTLS ingress acceptance require separately authorized external probes because they contact providers/accounts/certificate paths.
4. Paid staging is already healthy at the previously verified deployment; deploying the newer source-onboarding build is a separate external mutation and requires explicit authorization. If authorized, keep all five safety flags false.
5. When actual external integration credentials/accounts/certificates are connected and external contact is authorized, run one production-path acceptance per integration: MTProto/source observation, MT5 connectivity, cTrader connectivity, TradingView mTLS ingress; then one complete non-live E2E lifecycle and recovery/soak.
6. Do not enable `TRADING_ACCESS_ENABLED` until the central Mkety Auth Gateway issuer/audience/JWKS configuration exists and signed-access positive/negative acceptance passes.
7. Do not enable `BROKER_EXECUTION_ENABLED` for real-money paths until the separate final financial-limit approval.
8. Merge Trading runtime to `main` only on explicit owner instruction.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading core depend directly on Zitadel.
- Do not create a temporary Trading-only signer.
- Do not create separate backend/workspace/identity per custom hostname.
- Do not use caller-supplied workspace/account/provider/credential/execution hints as authority.
- Do not merge runtime to `main` without explicit instruction.
- Do not enable real-money execution without separate explicit approval and exact limits.

## Continuation discipline
After every meaningful verified milestone, record exact branch/code head, CI/run/job evidence, live environment changes actually performed, safety state, demonstrated defects/fixes and the exact next pickup here and in `AGENTS.md` when controlling state changes.
