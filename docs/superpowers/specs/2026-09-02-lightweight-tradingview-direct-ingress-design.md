# Lightweight TradingView Direct Ingress Design

Date: 2026-09-02
Status: Proposed / approved in chat, awaiting written-spec review
Branch: `design/enterprise-trading-event-core`

## Goal

Add a first-class TradingView webhook source that is light, simple, fast, and tenant-safe without weakening the existing signed `/api/v1/events` contract.

TradingView direct ingress is source-only. It must never gain broker, destination, workspace, execution, or credential authority from the alert body.

## Non-goals

- Do not replace or weaken `/api/v1/events` HMAC authentication.
- Do not put reusable secrets in TradingView webhook URLs or alert bodies.
- Do not add broker execution logic to the TradingView route.
- Do not create a second event-processing pipeline.
- Do not couple TradingView failures/retries/health to Telegram, MT5, cTrader, custom API, or other TradingView sources.
- Do not add MKSaaS database dependencies.

## Public route

Add one dedicated route:

`POST /api/v1/webhooks/tradingview/<public_source_handle>`

`public_source_handle` is a random public lookup identifier only. It is not a password and must never be treated as authentication.

The route is POST-only and should return quickly after validation + queue handoff.

## Trust boundary

Authentication is transport-level and source resolution is server-side.

1. Verify the request arrived through the expected TradingView webhook transport using Cloudflare TLS client-certificate metadata when available and configured.
2. Optionally use TradingView-published sender IP ranges as defense in depth, never as the sole tenant authority.
3. Fail closed when the configured transport-verification policy cannot establish that the request is acceptable.
4. Resolve exactly one active `tradingview_webhook` source by `public_source_handle` in the Trading database.
5. The resolved source row establishes trusted `workspace_id`, `source_connection_id`, source family/provider, and canonical account scope.
6. Caller body/query/path fields can never override workspace, source connection, destination, broker, execution, or credentials.

Because Cloudflare/TradingView environment behavior must be proven in staging, the verifier should be injectable/testable and default fail-closed when required verification metadata is absent.

## Alert contract

Require a small payload:

```json
{
  "event_id": "stable-alert-event-id",
  "text": "BUY XAUUSD NOW SL 2500 TP 2520",
  "occurred_at": "2026-09-02T18:00:00.000Z",
  "structured_payload": {},
  "metadata": {}
}
```

Rules:
- `event_id` is required and non-empty.
- `text` or a non-empty `structured_payload` is required.
- `occurred_at` is optional; when absent, use server receive time for transport metadata while preserving stable identity from `event_id`.
- body size is bounded.
- malformed JSON fails before queue handoff.
- authority-like fields are ignored/stripped recursively.

Canonical identity remains:

`tradingview:<accountScope>:<event_id>`

Persistent V1 idempotency remains authoritative across retries/restarts.

## Queue handoff

After transport verification and exact source resolution, enqueue a compact native source event into the existing source queue path.

The queued payload contains only safe event data plus the exact server-resolved source identifier required for the queue consumer to resolve the source again.

Do not place decrypted source secrets, workspace authority supplied by the caller, broker credentials, destination credentials, or execution flags in the queue message.

The existing queue consumer remains responsible for resolving the active source server-side and entering the normal V1 ingest pipeline.

## Isolation

Each TradingView source is independent.

- invalid source A request does not alter source B;
- disabled source A does not disable source B;
- queue failure for one request returns a retryable failure only for that request;
- duplicate event for source A is terminal for A and does not suppress another source/workspace;
- same `event_id` in another workspace remains separate because canonical uniqueness is workspace-scoped;
- TradingView route has no destination fan-out or broker execution state.

## Response behavior

Keep responses compact and secret-free.

Suggested outcomes:
- `202` accepted/queued;
- `400` malformed/invalid event;
- `403` failed transport verification;
- `404` unknown/inactive public source handle;
- `405` wrong method;
- `413` body too large;
- `503` queue/runtime unavailable.

Do not echo alert body, source secrets, certificate details, internal workspace IDs, or downstream response bodies.

## Storage

Prefer an additive non-secret `public_source_handle` on `source_connections` only if an existing safe field cannot serve this lookup purpose.

Requirements if a migration is needed:
- unique and indexed;
- server-generated random opaque value;
- not used as authentication;
- nullable for non-TradingView sources;
- no change to shared Mkety/MKSaaS schema;
- existing RLS/service-only posture preserved.

## Testing / acceptance

TDD RED before production changes.

Acceptance must prove:
1. valid verified TradingView request resolves exact source and queues once;
2. missing/invalid transport verification fails before source/event persistence;
3. unknown/disabled handle fails closed;
4. caller workspace/source/destination/execution hints are ignored;
5. stable `event_id` maps to canonical TradingView identity;
6. malformed/missing event identity fails before queue;
7. same native event is independently isolated by workspace;
8. one TradingView source failure does not affect a sibling TradingView source or Telegram/MT5/cTrader/custom sources;
9. queue failure is retryable and never claims success;
10. responses/loggable status remain secret-free;
11. existing `/api/v1/events` HMAC behavior remains unchanged;
12. all four mandatory CI gates pass.

## Staging gate

Source/CI completion does not equal production transport acceptance.

Before enabling a real TradingView source:
- deploy to non-live Cloudflare environment;
- inspect actual `request.cf.tlsClientAuth` behavior for TradingView webhook requests;
- verify the configured certificate/transport policy using real non-trading test alerts;
- verify fast acknowledgment and replay/idempotency;
- keep Trading entitlement and broker execution gates unchanged;
- never claim TradingView transport authentication is proven until this real staging test passes.

## Security decision

The first-class TradingView route will not use a reusable secret embedded in URL/query/body as its primary authentication mechanism. If Cloudflare cannot reliably verify the intended TradingView transport in the deployed environment, direct ingress remains disabled and an optional external relay using the existing signed-V1 HMAC client becomes the fallback.
