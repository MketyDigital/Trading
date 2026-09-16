# Multi-select Route Editor and Forward-as-is Restoration Design

Date: 2026-09-16
Status: Approved in chat for implementation
Branch: `feat/multiselect-routes-forward-as-is`

## Goals

1. Make existing and new routes simple to understand and edit: choose a source connection, select one or more allowed child feeds/channels, choose a destination, optionally narrow by symbols, and save.
2. Preserve the existing routing engine and stable object IDs. Do not require recreation of sources, destinations, broker accounts, Telegram bots, templates, or unrelated routes.
3. Make selective routing strict: for a given source+destination route group, only explicitly selected feeds may reach that destination. Unselected feeds must be skipped and must not silently inherit a legacy/default route to the same destination.
4. Retain an explicit `All channels from this source` mode for intentionally connection-wide routing.
5. Restore `Forward as-is (original)` prominently in the destination/template UI. Its contract is exact source-text forwarding with no AI, no cleanup, no reformatting, no branding/header/footer insertion.
6. Preserve every existing execution, management, reply, follow-up, broker, platform, market, symbol, risk, replay/idempotency, reconciliation, and safety behavior unless explicitly changed by this design.
7. Keep LIVE fully disabled during stabilization and DEMO acceptance.

## Current problem

The backend route schema models one granular route row with one `source_feed_id`. The current UI exposes that internal shape directly, so selecting three channels for one source→destination relationship can appear as three separate routes. Existing connection-level routes (`source_feed_id = null`) can also make fallback behavior difficult to reason about.

The destination formatting engine still supports four formatting modes (`none`, `clean`, `template`, `ai_then_fallback`), including verbatim mode, but the user-facing route/destination UI no longer makes `Forward as-is` sufficiently visible.

## User-facing route model

A logical route is presented as:

- Source connection
- Allowed channels/feeds (multi-select)
- Destination
- Optional allowed canonical symbols
- Optional blocked canonical symbols
- Priority
- Enabled state

Example:

- Source: Main
- Allowed channels: Signal A, Signal B
- Destination: Octa MT5 DEMO
- Allowed symbols: blank
- Blocked symbols: blank

Meaning: only Signal A and Signal B may reach that MT5 destination. Every other feed under Main is skipped for this logical source→destination relationship.

### All-channels mode

The UI includes an explicit `All channels from this source` option. Selecting it preserves connection-wide behavior and maps to the existing legacy/default route representation.

### Selective mode

If one or more child feeds are selected, the route is in selective mode. For that source+destination relationship:

- selected feeds are allowed;
- unselected feeds are skipped;
- a connection-level/default route to the same source+destination must not act as a fallback;
- unrelated destinations and routes are unaffected.

This same selection rule must be enforced by both destination delivery and broker execution planning.

## Persistence strategy

Do not introduce a new join-table migration solely for this UX.

The UI treats multiple feed-scoped route rows with the same source/destination/logical settings as one logical route group. Saving a logical route reconciles the underlying rows:

- add rows for newly selected feeds;
- update rows whose common route settings changed;
- remove or disable only the no-longer-selected feed rows belonging to that logical group;
- preserve the destination, source connection, broker account, templates, credentials, and unrelated routes;
- switching to `All channels` reconciles feed-specific rows for that group into the existing default route representation;
- switching from `All channels` to selective mode removes/disables the conflicting default route for that source+destination so fallback cannot broaden authority.

The implementation must be idempotent and workspace-scoped.

## Existing-route compatibility

Existing routes use the same editor as newly created routes.

For a legacy connection-level route such as `Main → MT5`, Edit shows `All channels from this source` selected. The user may switch to selected child feeds and save without recreating the MT5 destination/account.

For existing feed-scoped rows that represent the same source+destination and compatible settings, the UI groups them into one logical editable route and preselects the associated feeds.

## Symbol-filter semantics

Symbol filters narrow routing authority only.

- Allowed blank + Blocked blank: no route-level symbol restriction. Every canonical symbol that the destination account itself can actually trade remains eligible.
- Allowed populated: only those canonical symbols are eligible, still subject to the destination account's authoritative symbol catalog and risk/runtime gates.
- Blocked populated: those canonical symbols are skipped even if the account supports them.
- If both are populated, blocked wins on conflict.
- Filters can never make an unsupported symbol tradable.
- Invalid filter shapes fail closed for broker destinations.

Instrument eligibility remains capability-driven, not platform- or broker-name-driven.

## Destination formatting modes

The UI must expose the supported modes with plain-language descriptions:

### Forward as-is (original) — `none`
Send the original source message text. No AI, no cleanup, no deterministic reconstruction, no branding/header/footer/disclaimer insertion.

### Clean original — `clean`
Preserve the source message content while applying configured deterministic cleanup rules. No AI presentation.

### Structured template — `template`
Deterministically reconstruct the interpreted signal using configured labels/layout/brand/header/footer/disclaimer. Broker execution still consumes canonical intent, not this presentation text.

### AI presentation + safe fallback — `ai_then_fallback`
AI may improve presentation only. It cannot change canonical trading semantics. Timeout/failure/rejection falls back to deterministic template formatting.

Existing saved templates remain editable and functional. This design does not delete or rename their persisted IDs.

## Non-regression scope

The following must remain intact and continue to be covered by existing plus new regression tests:

- new signal execution;
- fast signals;
- follow-ups;
- management messages;
- stop-loss updates;
- move-to-breakeven;
- take-profit updates;
- partial and full closes;
- pending-order cancellation;
- replies and non-replies;
- Bot API and MTProto reply/thread correlation;
- explicit unresolved replies fail closed;
- Telegram Bot API and MTProto sources;
- Telegram destinations and reusable bot credentials;
- cTrader;
- MT5;
- multiple simultaneous MT5 terminal instances;
- all broker adapters through account capabilities rather than hard-coded broker/platform assumptions;
- all supported markets/instruments through authoritative account symbol catalogs;
- Forex, metals, indices, crypto, Derived/synthetic products where the destination account catalog exposes them;
- symbol mapping and account-specific risk rules;
- independent destination fan-out;
- destination failure isolation;
- route symbol filters;
- persisted-authority-over-caller-hints;
- idempotency/replay protection;
- broker reconciliation and repair-state behavior;
- no sibling cancellation;
- credential preservation during ordinary edits;
- source/feed editing without recreation;
- template editing without recreation;
- subscription/access lifecycle behavior;
- LIVE remains globally/workspace/account disabled during DEMO stabilization.

## Testing requirements

Add regression tests that prove:

1. Existing connection-level route loads as `All channels` and can be edited into selective feeds without recreating source or destination.
2. A logical route can select two or more feeds.
3. Selected feed reaches destination; unselected feed from the same source is skipped.
4. A former legacy/default route cannot broaden a selective source+destination group through fallback.
5. Unrelated destination routes still behave independently.
6. Blank allowed/blocked symbol filters permit all symbols supported by the destination account catalog.
7. Allowed/blocked filters narrow but never expand account capabilities.
8. Destination delivery and broker execution use the same selective authority semantics.
9. `Forward as-is (original)` is visible in the UI and produces the original source text without AI/cleanup/reconstruction/branding.
10. `clean`, `template`, and `ai_then_fallback` remain available and preserve their existing semantics.
11. Existing management/reply/follow-up suites remain green.
12. cTrader/MT5 and cross-platform capability-driven symbol suites remain green.
13. Final production/deployment safety checks prove LIVE remained disabled.

## Documentation

Update `AGENTS.md`, `CURRENT_HANDOFF.md`, the operator/customer manual, and relevant acceptance/runbook documentation to describe the logical multi-select route model, explicit all-channels mode, blank symbol-filter semantics, and all four destination formatting modes.
