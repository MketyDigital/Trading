# Account followers and isolated MT5 local copy

## Goal

Add two opt-in follower mechanisms without changing existing route or connector behavior:

1. A portal account follower for MT5 and cTrader. A follower is a normal connected account with one selected parent account in the same workspace. The parent account's canonical lifecycle is copied to the follower using the follower's own broker identity, catalog, safety policy, and lot policy.
2. A local MT5-only copier layered on the existing multi-terminal manager. It observes one configured parent terminal and mirrors confirmed broker state to one configured follower terminal without creating portal routes or D1 execution records.

Both mechanisms are disabled by default, one parent is allowed per follower, and a follower cannot become a parent of another follower in this first release. Existing explicit source-to-destination routes and existing connector workers remain authoritative when follower settings are absent.

## Invariants

- A follower link is workspace-scoped, unique by follower account, and rejects self-links, cross-workspace links, inactive accounts, and parent accounts already configured as followers.
- Portal fanout performs one batched account-link lookup per event. It never creates duplicate source route rows.
- Parent execution and follower execution are independent. A follower failure cannot roll back or suppress the parent or another follower.
- Follower actions use a follower-specific idempotency namespace and group identity. Broker success followed by state-binding failure repairs state and never resends the broker action.
- Unchanged follower configuration/state is not rewritten.
- MT5 local copy is opt-in, one parent profile to one follower profile, guarded by exact terminal identity and a local replay journal. It never sends a command when the parent snapshot is uncertain.
- Broker-originated close observation is read-only until an exact, account-bound position/deal identity is confirmed. Confirmed TP, SL, manual close, and partial close are distinct observations; unresolved history is retried with backoff. Open-position SL/TP edits require a separate current-position snapshot feed and are not inferred from close history.
- No LIVE account is enabled automatically. No production deployment or live broker mutation is part of this change.

## Portal data model

Add `trading_account_followers` (PostgreSQL) and its D1 equivalent:

- `id`, `workspace_id`, `follower_account_id`, `parent_account_id`
- `enabled`, `lot_multiplier`, optional `fixed_lot`
- `last_source_version`, `last_state_fingerprint`, timestamps
- unique `(workspace_id, follower_account_id)` and indexes on `(workspace_id, parent_account_id, enabled)` and `(workspace_id, follower_account_id, enabled)`.

The link repository exposes a batched `listEnabledByParents(workspaceId, parentIds)` operation and mutation methods that preserve authority fencing and replication journaling. The account repository exposes the link repository through the persistence runtime.

## Portal lifecycle

For signal, management, edit, and target-protection events, route resolution first determines the explicit parent broker accounts. One batched link lookup expands those parent IDs to follower account IDs. The existing planner then builds account-specific actions using each follower's catalog and risk policy. The follower plan carries `copiedFromAccountId`, derives a distinct group/idempotency namespace, and applies lot multiplier/fixed-lot policy. No route rows are synthesized.

For broker-originated parent close activity, a bounded observation runtime reads exact position/deal status from the existing MT5/cTrader adapters. It records a stable observation fingerprint and emits a canonical parent lifecycle event only when the broker account, position, and deal evidence match. Follower fanout reuses the same parent-link lookup. Manual close/partial-close activity that cannot be proven is logged as unresolved and does not trigger a broker action. Current open-position SL/TP edits are explicitly left behind the adapter snapshot-feed boundary until that read-only feed is added.

## D1 usage controls

- Use one account-link query per event with an `IN` parent-id set.
- Fan out in memory and execute independent follower plans in one batch; do not rescan source routes per follower.
- Add no-op guards for unchanged link/state fingerprints.
- Add due-only indexes and keyset pagination to recovery/observation scans.
- Back off non-critical unresolved broker observations and recovery scans.
- Preserve parent lifecycle event as the follower trigger so followers do not run independent source-route scans.

## Local MT5 copier

Extend `TerminalProfile` metadata with `copy_role` (`none`, `parent`, `follower`), `copy_parent_profile_id`, `copy_enabled`, `copy_lot_multiplier`, and optional `copy_fixed_lot`. Existing manifests load as `none`.

Add a pure, testable copier engine that:

- reads exact parent positions and broker history through the existing `MT5Engine` read-only APIs;
- maps positions by stable parent ticket plus symbol/side;
- opens/modifies/closes follower positions only after a complete parent snapshot;
- uses follower broker catalog/volume rules and a local SQLite replay journal;
- treats missing/ambiguous parent identity as unresolved, never as a close or new trade;
- runs separately from the gateway worker so portal connectivity and existing worker supervision are untouched.

The manager UI adds role/map/lot controls, but toggling remains explicit and cannot enable copying implicitly when a profile is paired or started.

## Compatibility and rollout

Existing accounts, routes, profiles, and connector configs continue to work unchanged. New tables/config fields are additive. Portal follower and local copier are off by default, demo-first, and require explicit operator enablement. Tests must cover one-to-one parent/follower, duplicate/replay, broker/manual observation classifications, unchanged-write suppression, batch query shape, and connector profile backward compatibility.
