# Granular routing / editability progress — 2026-09-16

Current branch: `feat/source-feeds-telegram-endpoints-mt5-multi-instance`

## Implemented on branch
- Additive `source_feeds` model for independently routable Telegram chats under one parent source connection.
- Feed-scoped routes with legacy/default connection-level route fallback preserved.
- Canonical-symbol route allow/block filters.
- Normal Telegram Bot API source credential mapping.
- Reusable encrypted Telegram destination bot connections plus multiple channel endpoints.
- Delivery-stage credential resolution from either legacy destination ciphertext or shared credential connection.
- MT5 multi-terminal connector flags (`--terminal`, per-instance `--ledger`) while preserving single-terminal defaults.
- Additive granular routing portal panel.
- Updated MT5 operator/customer documentation.
- Edit-in-place contract tests now define the next implementation batch.

## In progress
- Source configuration PUT with allowed-chat/feed reconciliation.
- Source-feed label/state edit.
- Route PUT/edit without recreation.
- Partial destination/template edits that preserve omitted settings and credential references.
- Reusable Telegram destination-bot rename/update without token rotation.
- Portal Edit controls for existing objects.

## Verification state
- No migration from this branch has been applied to production Supabase yet.
- No production deployment has been performed from this branch.
- LIVE execution settings have not been changed.
- Branch/PR CI must be green before merge/deploy/migration.

## Next
1. Observe RED CI for the newly added edit-contract tests.
2. Implement the minimum backend changes to make them green.
3. Add frontend edit controls and regression coverage.
4. Run full PR CI; inspect and correct compatibility failures.
5. Inspect current Supabase schema/constraint names and validate migrations before any database mutation.
6. Update `AGENTS.md` and `CURRENT_HANDOFF.md` with verified CI/migration/deployment state.
