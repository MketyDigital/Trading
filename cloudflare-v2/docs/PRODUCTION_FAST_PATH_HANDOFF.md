# Mkety Trading – Production Fast Path Handoff

**Purpose:** rolling continuation record. Read this together with repository-root `AGENTS.md`.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading is an independent runtime/data plane inside the Mkety ecosystem.
- Zitadel proves identity behind Mkety; the future central Mkety Auth Gateway issues short-lived signed Trading assertions.
- Trading verifies the Mkety assertion and then exact enabled workspace membership in Trading Supabase. Supabase remains final Trading authorization/revocation authority.
- Canonical entry is `trade.mkety.com`; optional customer hostnames are routing context only and never authorization.

## Latest verified milestone — 2026-09-05

### Production broker onboarding — CODE GREEN + LIVE DB READY
- Production onboarding code head: `d852de184c0b156dc360c4d242569b756acc2225`.
- Trading V1 CI run `33964408888`, test job `101301829090`: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all passed.
- Production admin account surface now supports:
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

### Current paid staging deployment
- Paid Worker: `mkety-copier-engine`.
- Last recorded deployed Worker version: `42e450f3-d801-45bb-a1af-5544233bded5` from deployed head `ecb28b0e28709a6ac2bc778e78aa1fa77db0b41f`.
- The newer production onboarding code head `d852de18...` is code/CI verified but has **not** been redeployed by this milestone.
- Hidden runtime bindings already include `SUPABASE_URL`, normalized `SUPABASE_SERVICE_ROLE`, and `TRADING_MASTER_KEY`; secret values were not intentionally logged or committed.

### Other already-verified boundaries
- Mkety signed Trading assertion verifier is implemented and fail-closed; `TRADING_ACCESS_ENABLED` remains false.
- Custom hostname -> workspace resolver is implemented; migration `0013` is live; `TRADING_CUSTOM_HOSTNAMES_ENABLED` remains false.
- MT5/cTrader demo acceptance workflows support all accepted service-role secret aliases and keep global broker execution false.
- External Telegram/MT5/cTrader acceptance has not yet been performed with real external credentials/accounts in this milestone.

## Safety state
Keep false unless a separately authorized rollout step changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution is authorized. Real-money enablement still requires separate explicit owner approval with exact financial limits, kill conditions and rollback procedure.

## Exact next pickup
1. Treat production MT5/cTrader account onboarding + live credential storage schema as ready; do not redesign it.
2. The next external mutation, if desired, is a separately authorized paid-staging redeploy of the current GREEN onboarding build with all safety fuses still false.
3. After redeploy, capture an actual `/api/v1/health` response through an approved path.
4. When actual external integration credentials/accounts are connected, run one production-path acceptance per integration: MTProto/source observation, MT5 connectivity, cTrader connectivity; then one complete non-live E2E lifecycle and recovery/soak.
5. Do not enable `TRADING_ACCESS_ENABLED` until the central Mkety Auth Gateway issuer/audience/JWKS configuration exists and signed-access positive/negative acceptance passes.
6. Do not enable `BROKER_EXECUTION_ENABLED` for real-money paths until the separate final financial-limit approval.
7. Merge Trading runtime to `main` only on explicit owner instruction.

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
