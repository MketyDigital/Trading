# Mkety Enterprise Trading Event Core — Design Specification

**Date:** 2026-09-01  
**Repository:** `MketyDigital/Trading`  
**Active project:** `cloudflare-v2/`  
**Status:** DESIGN — approved direction, implementation not started

## 1. Product intent

Mkety Trading is a multi-tenant enterprise trading automation solution delivered as a custom/enterprise Mkety product. It is not limited to one signal provider, one Telegram account, one broker, or one execution pattern.

The platform must accept trading events from multiple source technologies, interpret and correlate them safely, deliver human-readable signals to manual traders with very low latency, and independently translate validated trading intent into machine execution plans for configured trading destinations.

The engine must support Mkety-owned deployments and customer-specific enterprise deployments without forking the core product.

## 2. Core architectural decision

The current `raw Telegram message -> AI HTML -> extract params -> dispatch` flow is not the long-term source of truth.

The authoritative flow becomes:

```text
Source Adapter
  -> Authenticated Trading Event Envelope
  -> Idempotency / replay protection
  -> Source normalization
  -> Correlation / conversation state
  -> Deterministic parsing + optional AI interpretation
  -> Canonical Trading Intent / Management Event
  -> Deterministic validation
  -> Parallel destination fan-out
       -> Human Signal Delivery path
       -> Machine Execution Planning path
```

Formatting HTML is presentation logic for destinations such as Telegram. HTML must never be the authoritative machine-execution representation.

## 3. Latency model — parallel fast paths

Speed is a product requirement because paying signal subscribers may trade manually as soon as a Telegram message reaches them.

A normalized incoming event may therefore create multiple parallel paths:

```text
                        Incoming Event
                              |
                   Normalize / authenticate
                              |
                 Correlate enough to classify
                    /                     \
                   /                       \
     HUMAN DELIVERY FAST PATH       MACHINE EXECUTION PATH
       Telegram / webhook             parser / validation
       destination formatter          state / risk / policy
       immediate dispatch             execution planner
```

Neither path waits unnecessarily for the other.

### Human delivery rules

- Deterministic formatting should be preferred whenever the source is already understandable.
- AI formatting may be used when route configuration requires rewriting, branding, cleanup, translation, or interpretation.
- If the configured AI provider is slow/unavailable, a deterministic fallback formatter must preserve the signal and dispatch it instead of blocking delivery.
- Destination branding/custom formatting must never alter the canonical trading semantics.
- Telegram fan-out should be concurrent across independent destinations, with bounded per-destination timeouts and idempotency.

### Machine execution rules

- Machine execution must not depend on rendered Telegram HTML.
- Deterministic parsing and known source templates should be attempted before AI.
- AI may resolve ambiguous natural language but its structured output must pass deterministic validation.
- Invalid or uncertain execution intent fails closed while human delivery may still continue if the content is safe to forward.

## 4. Universal source contract

All sources map into one versioned `TradingEventEnvelope` contract.

Minimum conceptual fields:

```text
schema_version
workspace_id
source_id
source_type
source_instance_id
external_event_id
occurred_at
received_at

content_type
raw_text
structured_payload
attachments

thread_id
reply_to_external_event_id
edited_external_event_id

source_chat_id
source_message_id
source_symbol
source_metadata

auth_context
idempotency_key
```

Supported sources are adapter-driven and include, without core-engine changes:

- Telegram MTProto listener in Durable Objects;
- Telethon/Python or other VM/VPS listeners;
- TradingView webhooks;
- MT5/EA/bridge-originated payloads;
- cTrader-originated payloads;
- REST clients and customer systems;
- other Cloudflare Workers or Durable Objects;
- future custom adapters.

The ingestion API must accept signed/authenticated payloads from traditional VM systems and Cloudflare-native components through the same stable contract.

## 5. Universal destination contract

Destinations are also adapters behind a stable command interface.

Initial destination classes:

- Telegram Bot API / channel delivery;
- generic authenticated HTTP webhook;
- MT5 bridge/EA;
- cTrader Open API;
- Deriv product-specific adapter(s);
- future customer Worker/service;
- custom enterprise destination adapter.

A destination adapter receives a destination-specific command produced from canonical state. It does not re-interpret natural-language signals.

The system must support outbound payload delivery to arbitrary authenticated external systems without modifying the core engine for each customer.

## 6. Trading Event model

A source message is not assumed to be a new order.

Normalized event classifications include at least:

```text
NEW_SIGNAL
FAST_ENTRY
SIGNAL_COMPLETION
ENTRY_UPDATE
SL_UPDATE
TP_UPDATE
ADD_POSITION
REDUCE_POSITION
MOVE_SL_TO_BE
MOVE_SL
TRAIL_STOP
CLOSE
CLOSE_PARTIAL
CLOSE_ALL
CANCEL
CANCEL_PENDING
PENDING_ORDER
PENDING_ORDER_UPDATE
TP_HIT
SL_HIT
CORRECTION
INVALIDATE
COMMENTARY
NON_ACTIONABLE
```

Reply/thread/edit relationships are first-class correlation evidence.

## 7. Correlation and trade state

The platform must understand sequences of messages as one evolving trade.

Example:

```text
T0: BUY GOLD NOW
T+8s: BUY XAUUSD 2526 / SL 2518 / TP1 2530 / TP2 2535 / TP3 2545
```

If the workspace/route fast-entry policy allows immediate execution, the first message may create one position immediately.

When the complete signal arrives, the system correlates it with the existing active trade rather than creating an unrelated duplicate.

Final desired state:

```text
Existing fast position -> modify as Position Group Leg 1 -> TP1
Create Leg 2 -> TP2
Create Leg 3 -> TP3
Apply common/derived SL according to policy
```

The platform must support source-specific correlation windows, symbol aliases (`GOLD`, `XAUUSD`, broker suffixes), reply/thread linkage, timing, direction, entry proximity, and workspace configuration.

Ambiguous correlation must fail closed for machine actions rather than mutating the wrong position group.

## 8. Position Groups and execution legs

One trade intent may map to multiple broker positions.

```text
Trade Intent
   -> Position Group
        -> Leg 1 / TP1
        -> Leg 2 / TP2
        -> Leg 3 / TP3
        -> ...
```

The execution planner computes the delta between current broker/tracked state and desired group state.

Commands can include:

```text
CREATE_ORDER
MODIFY_ORDER
CANCEL_ORDER
CREATE_POSITION
MODIFY_POSITION
PARTIAL_CLOSE
CLOSE_POSITION
MOVE_STOP
SET_TAKE_PROFIT
```

The planner must be idempotent. Replaying the same event must not create duplicate positions.

## 9. Multi-TP allocation

The risk engine determines total permitted volume before splitting across TP legs.

Example:

```text
Allowed total volume = 0.09
TP count = 3
Equal allocation = 0.03 / 0.03 / 0.03
```

Volume allocation must respect platform-specific minimum, maximum, and step size rules. Uneven remainders must be assigned deterministically without exceeding total permitted risk.

Workspace/account policy may choose equal allocation or a configured weighting model.

## 10. Position management policies

Management behavior is configurable per workspace/route/account and not globally hard-coded.

Examples:

```text
breakeven_after_tp1
protect_tp1_after_tp2
close_partial_after_tp1
trail_after_tp1
trail_after_tp2
no_automatic_management
custom_ladder
```

Default Starpips-style example:

- TP1 reached -> close Leg 1 naturally; move remaining eligible legs to BE.
- TP2 reached -> close Leg 2 naturally; optionally move Leg 3 stop to TP1/protected level according to configured strategy.

Source management instructions such as `BE`, `close half`, `close now`, `cancel`, or replies to a signal must be reconciled against the same Position Group state.

## 11. Fast-entry policy

Fast-entry behavior is configurable for each enterprise workspace/route/account.

Modes:

```text
execute_immediately
wait_for_complete_signal
forward_only
```

For `execute_immediately`, the workspace defines safe defaults for lot/risk, accepted symbols, maximum age, execution type, and later reconciliation behavior.

Mkety/Starpips may use immediate execution while another customer chooses to wait for a full signal.

## 12. Parser and intelligence architecture

Parsing priority:

1. structured source payload;
2. source-specific deterministic template/parser;
3. universal deterministic parser;
4. symbol and terminology normalization;
5. active Trade State context;
6. optional AI interpretation for ambiguity/natural language;
7. deterministic post-AI schema validation;
8. execution-confidence/policy decision.

AI is an interpretation/formatting capability, not trading authority.

AI output for execution must be structured, schema-valid, and semantically validated for:

- action/side;
- normalized instrument;
- order type;
- entry/current-market semantics;
- SL relationship to entry and direction;
- TP ordering and direction;
- pending-order semantics;
- management-event target;
- unsupported/ambiguous instruments;
- account risk rules.

## 13. Risk engine

Risk calculation must be independent from source parsing and destination adapters.

Inputs include:

- account balance/equity;
- fixed risk or risk percent;
- account currency;
- symbol specifications;
- contract size;
- tick size/tick value;
- point/pip semantics;
- entry and SL;
- platform min/max/step volume;
- current exposure;
- workspace/account limits;
- number and weighting of TP legs;
- daily realized/floating loss and configured limits;
- margin data where available.

Outputs include:

- permitted/rejected decision and reason;
- total permitted volume;
- per-leg volume;
- estimated monetary SL risk;
- percentage risk;
- estimated target rewards;
- normalized platform order parameters.

No adapter may silently replace a failed risk calculation with an arbitrary default live lot size.

## 14. Durable Object responsibilities

Durable Objects are used for stateful coordination, not as the only durable database.

### Listener DO

- stores MTProto state/session safely;
- owns Telegram source connection lifecycle;
- emits authenticated universal event envelopes;
- reconnects/recover based on persisted lifecycle state;
- never assumes an outbound socket is immortal.

### Trade State / Correlation DO

A new stateful coordinator should serialize correlation and trade-state transitions for an appropriate key such as workspace/source/account strategy context.

It owns short-lived/evolving state needed to link fast signals, completions, replies, corrections, BE instructions, edits and cancellations without races.

Authoritative audit/idempotency records remain persistently stored outside warm-isolate memory.

### Cloudflare lifecycle constraint

Current Cloudflare documentation states that Durable Object WebSocket hibernation is for WebSockets accepted by the DO as a server; outgoing WebSockets do not hibernate. Active outbound sockets can defer eviction only for a bounded period. Therefore listener recovery must be explicitly designed and tested rather than relying on constructor reconnection alone.

Official reference:
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/

## 15. Queues and asynchronous work

Cloudflare Queues may be used for work where reliable asynchronous delivery is more important than minimum latency, including:

- audit persistence;
- non-critical destination retries;
- telemetry;
- notifications;
- dead-letter handling;
- delayed reconciliation work.

Cloudflare Queues are at-least-once, so every queued trading-related command must carry an idempotency key.

The primary fast delivery/execution path must not accumulate unnecessary queue hops.

Official reference:
- https://developers.cloudflare.com/queues/reference/delivery-guarantees/

## 16. TradingView ingress

TradingView is treated as another source adapter. Its webhook can POST JSON or plain text to a secure ingress endpoint.

Because TradingView documents a short webhook processing timeout, the ingress endpoint should authenticate/validate minimally, persist or route the event quickly, acknowledge promptly, then continue internal processing.

Official reference:
- https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/

## 17. Security and multi-tenancy

Production foundation requirements:

- real Zitadel JWT/JWKS validation for admin APIs;
- issuer, audience, expiry and not-before validation;
- workspace identity derived from trusted claims/server mapping;
- workspace scoping for every admin/database operation;
- enterprise entitlement enforcement;
- signed source-ingress credentials per source;
- timestamp + replay/idempotency protection;
- source credential rotation;
- destination webhook signing;
- encrypted tenant-managed secrets;
- no broker/Telegram/AI secrets in browser responses or logs;
- webhook secret verification where provider features support it;
- audit trail for configuration and execution decisions.

The current presence-only Bearer check is not sufficient for production.

## 18. Database evolution

Stop treating `db/schema.sql` as an indefinitely edited production schema.

Introduce numbered/checksummed migrations.

The data model will evolve from Telegram-specific routes toward generic concepts such as:

- workspaces;
- sources/source_credentials;
- routes;
- destinations;
- destination_credentials;
- trading_events;
- event_correlations;
- trade_intents;
- position_groups;
- position_legs;
- execution_commands;
- execution_results;
- account_risk_policies;
- instrument mappings/specifications;
- idempotency records;
- audit events.

Existing data should be migrated deliberately rather than dropped/recreated.

## 19. Broker adapter boundary

Each execution platform is independently verified.

### MT5

Use a documented authenticated bridge protocol. Python or EA runtime is allowed. The Cloudflare engine remains source-of-truth for event/risk/execution-plan semantics.

### cTrader

Implement current cTrader Open API authentication/account lifecycle and actual WebSocket JSON or Protobuf protocol. Do not preserve the current fake REST-shaped request as production behavior.

### Deriv

Separate Deriv product types explicitly. The existing short-duration `CALL`/`PUT` proposal/buy implementation is not a generic CFD copier.

Each adapter requires simulation/integration tests before live enablement.

## 20. Simulation and safety states

Every workspace/account supports explicit execution mode:

```text
disabled
shadow
simulation
live
```

`shadow` parses, correlates, calculates risk and generates commands without sending them.

Live enablement is account-specific and requires verified adapter readiness plus configured safety controls.

Required controls include:

- allowed instruments;
- maximum lot/volume;
- maximum risk per trade;
- maximum daily loss;
- maximum open exposure;
- maximum simultaneous position groups;
- kill switch;
- pending-order age/expiry;
- price/slippage tolerance;
- duplicate protection.

## 21. Production implementation sequence

### Foundation A — tooling, security and contracts

- test runner and CI;
- environment reference and config validator;
- authenticated universal ingress;
- real admin auth/workspace scoping;
- migration framework;
- secret-handling contract;
- canonical versioned event schemas;
- persistent idempotency.

### Foundation B — event pipeline and latency-safe fan-out

- universal event normalization;
- source adapters for existing Telegram DO and generic HTTP/VM;
- deterministic Telegram formatter/fallback;
- parallel human-delivery dispatcher;
- simulation trace/observability.

This milestone must preserve or improve current Telegram delivery latency.

### Foundation C — correlation and execution planning

- Trade State DO;
- event classification;
- fast-entry/completion reconciliation;
- Position Groups;
- replies/edits/cancel/BE/update handling;
- deterministic parser + AI structured fallback;
- risk engine;
- simulation-only execution planner.

### Adapter milestones

Build and verify independently:

1. MT5 bridge protocol/adapter;
2. cTrader Open API adapter;
3. Deriv selected product adapter(s);
4. custom outbound webhook adapter.

### VIP lifecycle milestone

Harden membership/payment flows independently after the core event foundation is stable.

## 22. Definition of first production-ready milestone

The first production milestone does **not** require live broker execution.

It is production-ready when:

- authenticated enterprise workspaces can configure sources/routes/destinations safely;
- Telegram DO and generic external payload sources feed the same versioned ingress contract;
- incoming events are persistently idempotent;
- manual-trader Telegram destinations receive signals through a latency-safe deterministic/AI-fallback formatting path;
- machine interpretation runs simultaneously and produces validated simulation commands;
- fast-entry and later full signals correlate correctly in replay tests;
- replies, edits, BE, close, cancel and pending-order events are represented correctly;
- risk/multi-TP calculations are deterministic and extensively tested;
- all admin APIs are tenant-safe;
- no live broker credentials/actions are required to prove the milestone.

Live execution becomes an adapter-by-adapter production capability after this foundation is verified.

## 23. Non-goals for the first implementation plan

- broad MkSaaS repository changes;
- a complete new customer dashboard redesign;
- enabling unverified live Deriv/cTrader execution;
- rewriting working VIP behavior before the event core is stable;
- splitting the system into many independent microservices without measured need.
