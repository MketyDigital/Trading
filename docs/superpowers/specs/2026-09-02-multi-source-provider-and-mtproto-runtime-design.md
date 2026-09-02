# Multi-Source Provider and MTProto Runtime Design

## Status
Approved direction from product owner on 2026-09-02. This design extends the existing Trading V1 universal-ingress architecture without replacing the legacy runtime or changing existing broker execution safety gates.

## Goal
Make Trading V1 source-agnostic and multi-provider: a workspace may enable any combination of Telegram MTProto, MT5, cTrader, TradingView, REST/custom API, and future source providers at the same time. The workspace admin may choose a preferred/default source provider where a default is meaningful, while unconfigured providers remain inert. Telegram MTProto must support interchangeable runtimes, with Cloudflare Container + Telethon as the preferred first-party runtime, pure Cloudflare Durable Object + mtcute as a supported alternative, and external signed listeners as first-class providers.

## Core Principles

1. **Sources and destinations are symmetric concepts.** Trading V1 must treat inbound providers as pluggable source connections just as outbound execution/notification destinations are pluggable.
2. **No source family is special to the trading engine.** Telegram, MT5, cTrader, TradingView, REST, and future sources all normalize into the existing Trading Event Envelope before interpretation/correlation/risk/execution.
3. **Multiple active source connections are allowed simultaneously.** A workspace may receive events from more than one provider and more than one source family.
4. **Default is preference, not exclusivity.** An admin-selected default source determines preferred first-party routing/UX where applicable, but does not disable other enabled sources.
5. **Unconfigured providers are inert.** Missing credentials/configuration for one provider must never block or degrade configured providers.
6. **At-least-once transport plus deterministic idempotency.** Recovery/retries/redundant listeners may replay events; canonical source identity prevents duplicate trading actions.
7. **No secrets in plaintext logs or API responses.** Provider credentials use existing encrypted-secret patterns.
8. **Legacy runtime remains intact until V1 is independently proven.**
9. **Failure isolation is mandatory across every pluggable boundary.** A source, destination, broker adapter, AI provider, customer integration, queue consumer, or workspace-specific configuration failure must not stall, disable, reorder, corrupt, or change the health/execution state of unrelated integrations. Retry state, circuit/health state, idempotency, rate limits, queues, credentials, kill switches, and error reporting are scoped to the smallest responsible integration/workspace/destination boundary. Global controls may exist only where intentionally defined as global safety controls.
10. **Fan-out is independently fault-tolerant.** When one canonical event targets multiple destinations/accounts, each delivery/execution receives its own persistent destination idempotency and outcome. One destination failure may be retried or failed independently and must never roll back, duplicate, or block already-valid sibling destinations.
11. **Source ingestion is independently fault-tolerant.** A slow, disconnected, misconfigured, or retrying source provider must not block another enabled source provider. Per-source receive/handoff queues and health are isolated; canonical event deduplication is shared only at the authenticated persistent ingestion boundary.
12. **Provider fallbacks never create hidden coupling.** A fallback provider may replace only the failed function it is explicitly configured to replace. Failure of an optional AI provider, MTProto runtime, broker, or destination cannot become a platform-wide startup/runtime dependency.

## Isolation Contract

The platform must enforce isolation at six levels:

1. **Workspace isolation** — one tenant's secrets, health, source configuration, risk policy, kill switch, queue retry, or destination failure never changes another tenant's state.
2. **Source isolation** — each source connection owns its transport/session health, receive-loop state, retry/backoff, checkpoint/recovery state, and provider configuration. Source defaults are preferences only and never disable sibling sources.
3. **Event isolation** — one malformed/ambiguous event fails closed for that event only. Persistent idempotency/correlation prevents replay from contaminating unrelated events.
4. **Destination/account isolation** — every destination delivery and broker account execution has independent authorization, risk policy, idempotency key, status, retry policy, and kill switch. A rejected/failed destination cannot suppress unrelated destinations.
5. **Provider isolation** — AI/broker/source provider availability is evaluated per provider call/connection. Provider health and rate-limit/backoff state must not be stored as one global mutable flag shared by unrelated tenants/providers.
6. **Control-plane isolation** — admin APIs may mutate only the explicitly authenticated workspace and targeted integration. Status APIs are read-only and must not have side effects on unrelated runtimes.

Tests must deliberately inject failures into one source/destination/provider/workspace and prove sibling integrations continue normally. This is a release gate, not optional resilience work.

## Source Provider Model

A source connection has these logical properties:

- `id`
- `workspace_id`
- `provider_type`
- `source_family`
- `enabled`
- `is_default`
- `priority`
- `display_name`
- `external_identity`
- encrypted credential/config references
- health/status metadata
- provider-specific non-secret configuration

Initial provider types:

- `cloudflare_container_mtproto`
- `cloudflare_do_mtproto`
- `external_mtproto`
- `tradingview_webhook`
- `mt5_source_bridge`
- `ctrader_source`
- `custom_signed_api`

Initial source families:

- `telegram`
- `tradingview`
- `mt5`
- `ctrader`
- `custom_api`

Provider registration must be data-driven. Adding a provider should require implementing a provider adapter/validator, not changing the canonical trading pipeline.

## Default Provider Semantics

A workspace may designate one enabled source connection as default per source family. A workspace may also expose a UI-level global preferred source when useful, but runtime ingestion does not require a default.

Rules:

- at most one default per `(workspace_id, source_family)`;
- setting a new default atomically clears the prior default for that family;
- disabling a default source leaves the family with no default until another is selected;
- ingress from any enabled authenticated source is accepted regardless of default status;
- provider absence never causes a startup failure for other providers.

## Canonical Cross-Provider Event Identity

Provider transport identity and source event identity are distinct.

For Telegram, redundant MTProto listeners observing the same Telegram message must converge on the same canonical external event identity. Preferred form:

`telegram:<telegram_account_scope>:<chat_id>:<message_id>`

The exact account scope is included only when Telegram semantics require it to disambiguate otherwise-identical chat/message identifiers. Provider implementation names such as `cloudflare_container_mtproto` and `cloudflare_do_mtproto` must not be part of the canonical event key.

Equivalent provider-independent identities will be defined for MT5/cTrader/TradingView/custom sources when native source IDs exist.

The existing persistent `trading_events` reservation/idempotency path remains the enforcement point.

## MTProto Runtime Providers

### Preferred: Cloudflare Container + Telethon

A single long-lived Cloudflare Container instance hosts one Telegram user/session and listens to all configured channels/groups reachable by that Telegram account. It forwards normalized raw Telegram events into Trading V1 through signed ingress or a Cloudflare Queue consumer that performs signed ingress.

Hard requirements:

- one Telegram session may monitor many chats;
- continuous connection under normal operation;
- Telethon automatic reconnect enabled;
- persistent Telegram session storage outside ephemeral container filesystem or restored deterministically on startup;
- last-observed/update checkpoints persisted;
- health endpoint/heartbeat exposed to the managing Worker/DO;
- restart-safe catch-up/backfill;
- outbound delivery decoupled from Telegram receive loop;
- delivery retry/backoff is scoped to this listener/source and never blocks unrelated source providers;
- a failed handoff retries the same payload without killing the delivery worker;
- no broker execution logic inside the listener;
- no tenant plaintext secrets returned through control APIs.

The container is the preferred first-party MTProto runtime because Cloudflare Containers provide a Linux/amd64 environment suitable for long-lived Python processes, while allowing Trading to stay on Cloudflare infrastructure.

### Alternative: Pure Cloudflare Durable Object + mtcute

The existing `MTProtoListenerNode` remains supported but is hardened rather than treated as the only implementation.

Required behavior:

- persistent mtcute authorization and update state in DO storage;
- update catch-up enabled;
- reconnect watchdog;
- DO alarm recovery;
- optional global Cron health sweep;
- queue/signed-V1 delivery;
- no dependency on a socket remaining immortal;
- same canonical Telegram event identity as Container/external providers.

### External MTProto

Customers or operators may run Telethon/mtcute elsewhere. They authenticate as a registered source connection and send signed Trading V1 events. External listeners must not require code changes to the Trading pipeline.

## MTProto Availability and Recovery

The system does not promise that any cloud process can never restart. The operational requirement is:

- continuously connected in normal operation;
- detect loss of connectivity quickly;
- reconnect automatically without human action;
- restore session without a new Telegram login;
- recover missed Telegram updates/messages within Telegram's available history/update window;
- duplicate replays remain harmless;
- downstream outages do not block the receive loop;
- retry exhaustion degrades only the affected source connection and records sanitized health instead of terminating unrelated source/provider runtimes.

The preferred Container runtime minimizes normal receive latency; catch-up/checkpointing protects against infrastructure restart gaps.

## Queue Boundary

Where supported, source listeners should enqueue compact source events immediately after receipt instead of synchronously waiting for interpretation/trading. Queue consumers then sign/submit to `/api/v1/events` or call an internal equivalent preserving the exact authenticated source identity.

Benefits:

- Telegram/other listener loops stay responsive;
- transient downstream errors retry independently;
- provider runtime remains simple;
- Trading V1 remains the sole interpretation/correlation/risk authority.

Queue use is optional for external/custom providers that already provide reliable delivery, but canonical idempotency remains mandatory.

Queue retry/DLQ behavior must preserve source/event identity and must not use a global failure latch that pauses unrelated source connections or destination processing.

## Other Source Families

### MT5

MT5 may act as an inbound source through the existing/future authenticated bridge. Source events can include orders, deals, position changes, or EA-generated messages. They normalize into Trading Event V1 and coexist with other source families.

Cloudflare Container feasibility: Cloudflare Containers are Linux/amd64 and MetaTrader 5 officially supports Linux via Wine. This makes hosting MT5 technically possible, but the `lite` 256 MiB instance is not a reliability target for MT5+Wine. Any Cloudflare-hosted MT5 experiment must be separately gated and benchmarked, starting no smaller than a realistic resource tier; it is not part of the MTProto implementation batch.

### cTrader

cTrader source connections use Open API/event streams where available. They are independent of cTrader destinations/execution accounts even when they refer to the same customer account.

### TradingView

TradingView webhook sources remain stateless ingress providers authenticated by their configured source secret and normalized into the same envelope.

### Custom API

Custom signed sources may submit structured or natural-language events through the existing universal V1 ingress contract.

## Health Model

Each source connection reports provider-appropriate health without forcing a common transport implementation. Common fields include:

- `status`: `UNCONFIGURED | STARTING | HEALTHY | DEGRADED | DISCONNECTED | DISABLED | ERROR`
- `last_heartbeat_at`
- `last_event_at`
- `last_connected_at`
- `last_disconnected_at`
- `restart_count`
- `last_error_code` (sanitized)
- delivery attempt/success/failure counters where the runtime performs handoff delivery
- `last_delivery_at`
- `last_delivery_error_at`

Health changes do not mutate canonical trade state. Health state is scoped to the relevant source/provider/destination; aggregations are derived views and never become shared mutable execution state.

## Security

- Reuse `TRADING_MASTER_KEY` encrypted-secret primitives.
- Source secrets are never returned after creation except one-time bootstrap flows explicitly designed for that purpose.
- Container/DO/external runtimes authenticate to V1 with registered source identity and HMAC or an equivalent scoped internal credential.
- Workspace identity is server-resolved from source registration, never trusted from listener payload.
- Cross-provider duplicates are deduplicated only after source authentication.
- Internal transport credentials authorize only the narrow handoff operation and never confer broker/destination/admin authority.

## Data Model Changes

Prefer extending `source_connections` rather than creating provider-specific top-level source tables. Provider-specific runtime state may live in dedicated Trading-owned tables/DO/container storage when necessary, but the canonical registry remains `source_connections`.

Expected additions:

- `source_family`
- `provider_type`
- `is_default`
- `priority`
- `display_name`
- `external_identity`
- `config` JSONB for non-secret provider options
- health timestamps/status

Database constraints/indexes enforce one default per workspace/source-family and efficient enabled-provider lookup.

Destination/account execution state remains separately persisted so one destination retry/failure never rewrites canonical source/event state or sibling destination state.

## Compatibility

- Existing signed `/api/v1/events` contract remains valid.
- Existing source registry records must migrate safely with provider defaults inferred conservatively.
- Legacy `/api/webhook/process_signal` remains unchanged.
- Existing TradingView/custom ingress continues to work.
- Existing MT5/cTrader execution adapters are not modified by source-provider registration except where shared naming/types must be generalized.

## Testing Strategy

TDD is mandatory.

Coverage must include:

- multiple enabled providers in one workspace;
- one default per source family;
- switching default without disabling alternatives;
- no configured provider: inert/no error;
- disabled provider rejected;
- cross-provider Telegram duplicate collapses to one canonical event;
- provider-specific authentication still resolves trusted workspace server-side;
- Container provider health/restart/catch-up unit contracts using fakes (no live Telegram in CI);
- listener delivery failure retries the same payload with bounded backoff and the listener remains alive;
- one failed source handoff does not block another source/provider;
- one failed destination/account delivery does not block or duplicate sibling destinations;
- one workspace kill switch/provider outage/config error does not affect another workspace;
- AI provider timeout/failure is scoped to the requesting pipeline and configured fallback chain;
- DO provider recovery/catch-up contracts;
- MT5/cTrader/TradingView/custom source registrations coexist;
- legacy route remains unchanged;
- full Worker/core, MT5 bridge, MTProto listener, and Wrangler dry-run CI remain green.

## Delivery Sequence

1. Generalize source registry/data model and default semantics.
2. Add provider registry/interfaces and canonical source identity helpers.
3. Add cross-provider idempotency tests.
4. Build Cloudflare Container MTProto provider skeleton with Telethon listener, health, persistence contract, and signed/queued V1 delivery.
5. Harden Container handoff retry/recovery and prove source-level failure isolation.
6. Harden existing DO MTProto provider to the same provider interface and canonical identity.
7. Add external MTProto provider bootstrap/validation.
8. Register MT5/cTrader/TradingView/custom source provider metadata without changing destination/execution behavior.
9. Add admin read/update APIs for enabling/disabling/default selection and health.
10. Add explicit source/destination/workspace/provider failure-isolation acceptance tests.
11. Run non-live acceptance and long-duration MTProto soak/restart tests before production activation.

## Non-Goals for This Batch

- Running meaningful-capital live trades.
- Replacing legacy execution.
- Hosting MT5 in Cloudflare Containers.
- Building final frontend UI.
- Deriv implementation beyond existing architectural placeholders.
