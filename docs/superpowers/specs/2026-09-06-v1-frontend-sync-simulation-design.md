# Trading V1 Frontend Synchronization & Safe Simulation Design

## Goal
Make the real Mkety Trading frontend use the same V1 API and database contracts as the production Worker, and add a production-shaped simulation mode that exercises identity, workspace authorization, persistence, source ingestion, normalization, risk, execution orchestration, audit and UI refresh without connecting real MT5, cTrader or Telegram accounts.

## Source of truth
- `cloudflare-v2/src/v1_entry.js` is the deployed Worker entrypoint.
- `/api/v1/*` is the supported Trading surface.
- Legacy `/api/admin/*` and `/api/webhook/process_signal` remain retired and must not be restored.
- Trading Supabase state is authoritative for workspace membership/revocation, sources, accounts, policies, events, retries and audit.
- Caller-provided workspace/account/provider/credential hints never become authority.

## Frontend architecture
Replace the legacy generic `dbProxy()` dashboard contract with a focused V1 frontend client. The real browser flow is:

`UI action -> V1 client -> /api/v1/admin/* -> Mkety assertion verification -> workspace membership/permission -> V1 store -> Supabase -> canonical response -> UI refresh`.

The frontend exposes supported Trading areas only:
- Overview
- Sources
- Broker accounts / destinations
- Users / members
- Operations
- Events / audit
- Risk & execution
- Settings
- Domains / hostnames

Legacy VIP/bank/payment functionality may remain only as legacy non-Trading behavior if separately supported, but it must not use or re-enable the retired Trading admin proxy.

## Identity / Zitadel boundary
Zitadel remains an upstream adapter behind Mkety identity. Trading does not authorize directly from Zitadel-specific claims. Production access still requires a valid Mkety Trading assertion plus final Supabase membership/entitlement checks.

For repository acceptance only, a synthetic Mkety assertion verifier may be injected through existing dependency-injection seams. It must never become an anonymous production fallback and must not be enabled from caller-controlled request values.

## Safe full-stack simulation
Add an explicit server-owned execution transport mode with values conceptually equivalent to:
- `real`: existing production adapters and credentials.
- `simulation`: production-shaped fake Telegram/MTProto, MT5 and cTrader adapters.

Simulation must be selected from trusted runtime configuration or test dependency injection, never from request payloads. It may exercise logical feature gates as enabled, including account execution flags, while guaranteeing no network call or order reaches a real external provider.

Simulation responses must use production-shaped result contracts so orchestration, persistence, idempotency, retries, risk checks and frontend rendering follow the same path as real execution.

## Audit/debug observability
Add structured, redacted trace data for acceptance runs:
- request/trace ID
- workspace ID
- authenticated subject
- source ID/provider
- canonical event ID
- destination/account ID
- execution decision and reason
- adapter mode (`simulation`/`real`)
- result status
- timestamps

Never expose credentials, tokens, raw authorization headers, decrypted secrets or internal stack traces.

## Frontend synchronization requirements
For each supported page and action:
1. Correct workspace-scoped data renders from V1 endpoints.
2. Loading, empty, validation, authorization and server-error states are visible.
3. Create actions persist through V1 API and redraw from canonical server data.
4. Edit actions prefill canonical values, persist intended fields only and redraw.
5. Delete/deactivate actions use explicit lifecycle endpoints where available and cannot cross workspace boundaries.
6. Toggles such as activation, execution enablement and kill-state changes display the persisted server result, not optimistic-only state.
7. Every tab/button/form used in the real UI has automated contract coverage.

## Test strategy
Use TDD. Add tests before implementation for:
- dashboard no longer references retired `/api/admin/*` endpoints;
- dashboard V1 client sends bearer token and `X-Mkety-Workspace-Id` on protected requests;
- page definitions correspond to supported V1 route families;
- create/edit/deactivate flows consume canonical API responses;
- settings save is real persistence or clearly read-only, never a fake success alert;
- synthetic identity is available only through test/server-owned injection;
- simulation adapters cannot perform network I/O and return production-shaped results;
- end-to-end synthetic Telegram/MTProto -> normalize -> persist -> risk -> cTrader/MT5 simulated execution -> audit result;
- broker/source events can flow back into persisted event/audit state for frontend display;
- workspace isolation and idempotency remain enforced.

## Safety constraints
- Do not merge `main`.
- Do not enable real-money execution.
- Do not add real broker/provider credentials.
- Do not restore the legacy generic DB proxy as a Trading path.
- Do not weaken workspace isolation, Mkety assertion verification, Supabase final authorization, broker server-owned configuration, risk/kill checks, broker-authoritative validation or persistent idempotency.
- Gate 7 remains blocked until credentials/accounts are independently proven demo-only.

## Definition of done
The feature branch is ready for staging when the complete repository suite is green and automated tests demonstrate that the real frontend contract, V1 APIs, Supabase-facing stores and simulated external adapters operate coherently with no retired Trading endpoint dependency and no real external execution.