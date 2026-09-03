# Hot-Path Isolation and Resilience Design

**Date:** 2026-09-03
**Status:** Approved architecture, pending implementation-plan review
**Product:** Mkety Trading V1

## Purpose

Mkety Trading must minimize signal loss, execution failure, and platform-added latency while preserving fail-closed trading safety. A clear, valid, authorized signal must not be blocked by failures in non-critical systems such as AI formatting, Zitadel/admin UI, analytics, audit, reporting, notifications, historical queries, or destination presentation services.

This design separates the latency-sensitive trading hot path from optional or administrative work and defines explicit degradation behavior for every dependency.

## Non-negotiable invariants

1. No non-critical subsystem failure may stop a valid clear signal or an already-authorized valid trade.
2. Only execution-critical correctness or safety conditions may block broker execution.
3. AI is optional for clear trade execution and mandatory only when deterministic interpretation cannot safely resolve ambiguity.
4. Telegram destination AI is presentation-only. It must never mutate canonical trading semantics.
5. AI destination failure or timeout must fall back to deterministic destination formatting rather than delay forwarding indefinitely.
6. Zitadel is not in the live signal-to-broker request path. It authorizes users/admins and produces durable workspace/member authority; live source processing does not synchronously call Zitadel.
7. Admin audit, analytics, reporting, dashboards, notifications, email, historical queries, exports, and similar control-plane work are off the live signal-to-broker path.
8. Persistent broker/destination idempotency and broker reconciliation remain mandatory even when they add a small correctness latency cost.
9. Critical safety revocation such as source disablement, account disablement, account execution disablement, kill switch, workspace entitlement removal, or Worker broker fuse changes must not be bypassed by stale cache.
10. Management commands such as CLOSE, CLOSE PARTIAL, BREAK EVEN, CANCEL, and MODIFY are latency-sensitive and receive the same or higher priority as new entries.
11. No feature may implicitly enable `BROKER_EXECUTION_ENABLED` or `TRADING_ACCESS_ENABLED`.
12. Real-money activation still requires explicit separate final user approval.

## Availability objective

Literal 100% uptime cannot be guaranteed because Telegram, networks, brokers, Cloudflare, databases, and external providers can fail. The engineering objective is instead:

- eliminate avoidable platform-caused failures;
- isolate partial failures;
- keep clear signals operational when optional systems fail;
- retry safely where broker reconciliation proves retry safety;
- quarantine uncertain broker outcomes rather than risk duplicate orders;
- recover automatically from transient infrastructure failures when safe;
- expose measurable end-to-end latency and failure-rate evidence before production cutover.

## Architecture

### Fast execution path

```text
Telegram / authenticated source
  -> canonical source event identity
  -> deterministic parse + normalization
  -> versioned runtime execution snapshot
  -> deterministic validation
  -> account safety / risk
  -> persistent destination idempotency
  -> warm broker adapter/session
  -> broker acknowledgement / reconciliation
  -> exact Trade State binding
```

The fast path must not synchronously depend on:

- Zitadel network calls;
- admin UI;
- audit-log writes;
- analytics/reporting;
- destination AI formatting;
- historical queries;
- notifications;
- email;
- dashboard refreshes;
- exports;
- unrelated database reads.

### Telegram destination path

```text
Canonical Trading Event
  -> deterministic destination formatter
  -> configured deterministic transformations
  -> optional AI presentation/rebranding
  -> Telegram destination
```

Destination AI may perform presentation transformations such as:

- rebranding;
- natural-language rewriting;
- emoji/style changes;
- translations;
- prefixes/suffixes;
- disclaimer insertion;
- field ordering;
- user-specific destination templates;
- explanatory copy;
- deterministic P&L annotations from canonical values.

Destination AI must never be authoritative for:

- symbol;
- BUY/SELL direction;
- entry price/zone;
- stop loss;
- take-profit values;
- Position Group identity;
- broker account selection;
- lot/risk decision;
- execution command.

If destination AI fails, times out, rate-limits, or returns invalid output, the system sends the deterministic formatted fallback unless the destination itself is unavailable.

### Trade-execution AI path

```text
Incoming text
  -> deterministic parser
  -> deterministic normalization
  -> if clear: continue immediately
  -> if ambiguous: bounded AI resolver
  -> deterministic post-validation
  -> if resolved safely: continue
  -> otherwise: NEEDS_REVIEW / no broker guess
```

Trade-execution AI must use strict bounded timeouts and must not be called for already-clear instructions.

AI failure behavior:

- clear deterministic trade: continue without AI;
- ambiguous trade: do not guess; mark for review according to configured policy;
- destination formatting: deterministic fallback and continue forwarding.

## Runtime execution snapshots

Frequently used source/account/risk/platform configuration should be represented as a versioned runtime execution snapshot so every signal does not require repeated full database retrieval.

A snapshot may contain only server-authoritative non-secret runtime values needed for execution, including:

- workspace authority/version;
- source ID/type/enabled state;
- account ID/platform/active/execution-enabled state;
- normalized safety policy;
- fast-entry policy;
- entry-zone policy;
- symbol mapping/catalog version;
- broker metadata version;
- relevant risk configuration.

Credentials remain protected server-side and are not copied into public/admin/client-visible caches.

### Snapshot invalidation

Critical revocations must invalidate execution authority immediately or force an authoritative version check before dispatch. Examples:

- source disabled;
- workspace entitlement disabled;
- account inactive;
- account execution disabled;
- kill switch enabled;
- global execution fuse disabled.

Performance optimization must never allow a stale snapshot to execute after a safety revocation.

The broker coordinator therefore retains a final server-authoritative safety gate immediately before dispatch. Snapshotting reduces repeated configuration work but does not remove the final execution authority check.

## Database behavior

The database is not removed from correctness-critical behavior. Instead, database use is divided into two categories.

### Mandatory critical persistence

These remain synchronous where necessary for correctness:

- canonical event idempotency/reservation;
- destination/order idempotency;
- broker reconciliation/retry ownership;
- exact execution state needed to prevent duplicate or conflicting broker commands.

### Off-path persistence

The following must not block live trade execution when their failure does not affect correctness:

- audit records unrelated to the broker command itself;
- analytics;
- reports;
- historical summaries;
- dashboards;
- notification history;
- destination presentation metadata.

Where off-path persistence fails, the system records/queues degradation where possible but does not fail an otherwise valid broker command.

## Broker connectivity

Broker integrations should use warm connections/sessions where supported.

### MT5

- reuse the persistent bridge runtime;
- use existing `command_id` replay/reconciliation behavior;
- preload/cache broker symbol metadata with bounded refresh;
- retry ambiguous open-position transport failures only with the same command identity and reconciliation contract;
- never create a new logical command ID merely to retry the same intended order.

### cTrader

- maintain warm authenticated sessions;
- reuse authoritative symbol/account metadata;
- pre-send transport failure may be retryable;
- post-send ambiguity remains `UNCERTAIN` until broker-side reconciliation proves whether execution occurred;
- never blind-resend an uncertain order.

## Prioritization

Execution work has higher priority than presentation/control-plane work.

Priority order:

1. kill/revocation controls;
2. active-position safety/management commands;
3. new authorized entries;
4. safe destination retry/recovery;
5. Telegram presentation delivery;
6. destination AI enrichment;
7. audit/analytics/reporting/notifications.

A lower-priority subsystem must not occupy the only execution worker or create unbounded head-of-line blocking.

## Timeouts and circuit breakers

Every external dependency receives a bounded timeout appropriate to its role.

- execution broker call: broker-specific timeout followed by reconciliation classification;
- trade ambiguity AI: short bounded timeout; no indefinite wait;
- destination AI: short bounded timeout then deterministic fallback;
- optional analytics/audit/notification provider: off-path and independently retried where appropriate;
- historical/admin queries: never consume trading execution capacity.

Repeated provider failure should open a provider-specific circuit breaker rather than repeatedly delay every event.

Circuit breaker state must be isolated by provider/workspace where relevant so one failing destination or AI provider does not disable unrelated workspaces or brokers.

## Failure matrix

| Failure | Clear trade execution | Telegram destination | Required behavior |
|---|---|---|---|
| Zitadel unavailable | Continue for already-authorized runtime | Continue | Admin login/config may be unavailable; hot path unaffected |
| AI provider unavailable | Continue if deterministic | Fallback deterministic | No clear trade blocked |
| Destination AI timeout | Continue | Fallback deterministic | Do not wait indefinitely |
| Audit/analytics failure | Continue | Continue | Off-path degradation |
| Dashboard/reporting failure | Continue | Continue | Off-path degradation |
| Telegram destination unavailable | Continue broker execution if configured independently | Retry destination safely | Destination failure cannot cancel broker trade |
| Supabase optional query failure | Continue where snapshot + mandatory state allow | Continue/fallback | No unrelated query dependency |
| Mandatory idempotency store unavailable | Block affected broker command | Destination may retry later | Correctness-critical fail closed |
| Broker unavailable | Cannot execute affected account | Telegram may still deliver | Retry/reconcile according to broker semantics |
| Broker response uncertain | Do not duplicate | Telegram may report pending state | Reconcile or quarantine |
| Account kill switch | Block immediately | May still publish configured status | Safety wins over speed |
| Source/account disabled | Block immediately | Stop affected source/account behavior | Safety authority wins |

## Latency instrumentation

Every event should support monotonic/UTC correlation timestamps for at least:

- source received;
- canonical event persisted;
- deterministic interpretation completed;
- AI started/completed when used;
- account plan ready;
- idempotency reservation completed;
- broker send started;
- broker acknowledgement/reconciliation completed;
- Telegram destination formatting started/completed;
- destination send acknowledgement.

Metrics must be secret-free and workspace-safe.

Primary launch measurements:

- platform-added clear-signal execution latency;
- source-receive -> broker-send latency;
- broker-send -> broker-ack latency;
- clear signals requiring AI percentage;
- AI fallback rate;
- destination deterministic-fallback rate;
- duplicate-prevention/reconciliation rate;
- broker retryable/uncertain/failed rate;
- Telegram destination success/retry rate.

No fixed millisecond SLA is declared before real staging measurements. The target is to reduce Mkety-added healthy-path latency toward tens of milliseconds where Cloudflare/runtime geography and mandatory persistence permit, while measuring actual p50/p95/p99 rather than claiming an artificial guarantee.

## Admin audit relationship

The append-only admin audit subsystem remains required for sensitive control-plane mutations, but it belongs outside the live source-to-broker path.

Admin mutation requests may synchronously require audit persistence if that is necessary for administrative accountability. That latency is acceptable because it affects configuration operations, not live trade execution.

Live trading never waits for a membership/source/account admin audit append.

## Telegram destination resilience

Telegram destinations are independent siblings. One destination failure must not prevent:

- broker execution;
- another Telegram destination;
- another workspace;
- another source;
- another broker account.

Destination formatting configuration is versioned. A malformed user AI prompt/template cannot gain authority over the canonical Trading Event. Deterministic validation compares any AI-rendered structured values against canonical values before a message is emitted when structured trade fields are included.

If that validation fails, send the deterministic template instead.

## Security/performance boundary

Security checks are categorized by whether they are hot-path mandatory.

### Mandatory hot-path security

- authenticated source identity;
- exact workspace/source ownership;
- canonical event idempotency;
- final account active/execution state;
- final safety policy/kill switch;
- broker execution master fuse;
- persistent destination idempotency;
- credential isolation;
- broker reconciliation.

### Off-path/control-plane security

- Zitadel interactive authentication;
- membership administration UI;
- audit browsing;
- reports;
- historical event browsing;
- dashboard operations queries.

These controls remain secure but do not become synchronous dependencies of every live signal.

## Testing requirements

Implementation must add deterministic tests proving:

1. clear trade execution does not call AI;
2. AI failure cannot block clear deterministic execution;
3. destination AI failure falls back to deterministic formatting;
4. Telegram destination formatting cannot alter canonical execution values;
5. Zitadel/admin dependencies are absent from the live execution dependency graph;
6. optional audit/analytics/reporting failures do not cancel broker dispatch;
7. broker execution fuse denies work before expensive execution dependencies are constructed;
8. a safety revocation invalidates/rechecks cached execution authority before broker dispatch;
9. one destination failure does not stop sibling destinations or broker execution;
10. management commands are not queued behind optional AI/presentation work;
11. mandatory idempotency failure blocks the affected broker command rather than bypassing protection;
12. MT5 retry reuses the exact logical command identity;
13. cTrader uncertain post-send outcomes never blind-retry;
14. latency timestamps are emitted without secrets;
15. provider circuit breakers are isolated and bounded;
16. normal execution still works when optional systems are deliberately injected as failed.

## Production acceptance requirements

Before Gate 10 cutover, staging must demonstrate:

- real Telegram receive/restart/catch-up soak;
- healthy clear-signal latency distribution;
- clear signals executing with AI disabled/unavailable;
- destination forwarding continuing with destination AI disabled/unavailable;
- controlled database optional-query outage without hot-path failure;
- kill-switch response under cached-config conditions;
- broker disconnect/reconnect and reconciliation behavior;
- MT5 safe replay behavior;
- cTrader uncertain-state quarantine;
- sibling account/destination isolation;
- sustained execution + destination throughput without queue starvation;
- p50/p95/p99 signal-to-broker timing evidence;
- failure-rate and recovery-rate evidence;
- all runtime master fuses still fail closed until the explicit cutover action.

## External integration contract

Zitadel, Telegram credentials/sessions, broker credentials, TradingView certificate/domain, Supabase environment values, and AI provider credentials remain plug-in integration/configuration boundaries.

Their final real values must not require core product-logic rewrites. Real-environment acceptance may reveal an incompatibility; such a compatibility fix must preserve the interfaces and safety/performance invariants in this document.

## Out of scope

This design does not:

- enable real-money execution;
- merge the feature branch into `main`;
- promise literal 100% uptime;
- bypass mandatory durable idempotency for latency;
- allow AI to become execution authority;
- weaken kill switches or source/account disable controls;
- introduce a second trading event or destination ledger;
- require external service setup during static implementation.
