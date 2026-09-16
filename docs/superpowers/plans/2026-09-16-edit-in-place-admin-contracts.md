# Edit-in-place admin contracts — 2026-09-16

## Goal
Preserve all existing Mkety Trading functionality while making existing configuration objects editable in place wherever safe: sources, materialized source feeds, routes, destinations, templates, and reusable Telegram destination bot connections. Creating a replacement object should not be required for ordinary configuration changes.

## Safety / compatibility rules
- No automatic LIVE enablement or broker-safety mutation.
- Existing IDs remain stable during edit operations.
- Provider/source type identity stays immutable on an existing source; edit safe metadata/config instead of morphing one provider into another.
- Secret rotation remains explicit through dedicated credential endpoints. Ordinary edits must never blank/replace an existing secret accidentally.
- Partial edits preserve omitted fields.
- Source config remains authoritative for Telegram allowed-chat authorization. Editing its allowed-chat list reconciles child `source_feeds`: add/reactivate newly allowed chats and deactivate feeds no longer allowed.
- Existing connection-level/default routes and legacy Telegram destination credential ciphertext remain supported.
- Route edits may change feed scope, destination, priority, name, and validated filters while preserving the route ID.
- Database workspace/FK authority remains fail closed.

## TDD sequence
1. RED: add API contract tests for source edit + feed reconciliation, feed edit, route edit, partial destination/template edits, and destination-bot rename.
2. GREEN: implement minimal store/handler changes.
3. Add focused store/feed reconciliation tests if needed.
4. Add portal edit controls that load existing values and use edit endpoints instead of delete/recreate.
5. Update `AGENTS.md` and `CURRENT_HANDOFF.md` with exact progress and remaining verification.
6. Run PR CI and inspect failures. Do not apply migrations or deploy until branch CI is green.
7. Verify migrations against current Supabase schema/constraints before production mutation.
