# Real Production DEMO Acceptance — 2026-09-17

## Authority

For this trading system, release acceptance is based on controlled **real production DEMO traffic** through the same runtime path customers use:

Telegram source -> persisted source/feed authorization -> trading event ingestion -> deterministic/AI interpretation -> correlation/management -> persisted routes -> independent Telegram/cTrader/MT5 destinations -> durable broker/delivery state -> operation journal/recovery.

Legacy staging Gate 6/Gate 7 workflows are optional diagnostics only. Missing staging secrets do not block release when the real production DEMO path is available and verified. They must never be used as a reason to enable LIVE without production DEMO evidence.

## Mandatory safety posture before every real DEMO test

- `trading_access_enabled = true` only for the intended controlled test.
- `broker_execution_enabled = true` only for intended DEMO execution.
- `live_broker_execution_enabled = false` globally.
- DEMO target accounts may have `execution_enabled = true` and `live_execution_enabled = false`.
- Every LIVE account must remain `execution_enabled = false` and `live_execution_enabled = false` until the full production DEMO matrix passes and a separate LIVE authorization is given.
- Re-query controls/accounts immediately before and after broker-affecting tests.

## Production DEMO matrix

Evidence must come from new production events created after the deployed code version under test.

1. Plain market signal reaches the intended Telegram destination and each intended DEMO broker account.
2. Replay of the exact same source event does not create a duplicate broker order or duplicate destination message.
3. Fast/incomplete signal followed by full signal correlates to the same logical group without duplicate OPEN.
4. Genuine Telegram reply metadata is preserved; reply management targets the original group/position and the Telegram destination reply points to the corresponding destination message.
5. No-reply management may correlate only when the existing correlation rules find one safe unique target; ambiguity remains fail-closed.
6. Telegram edit of the same source message is persisted as a revision, never opens a duplicate position, and applies only permitted management deltas to the existing group.
7. Telegram destination edit updates the mapped destination message; missing edit mapping must fail rather than falling back to a new send.
8. Explicit protection removal/BE/TP/partial-close/full-close/pending-cancel management retains existing lifecycle semantics.
9. Invalid protection fields follow the configured workspace policy; strict reject remains the compatibility default, while opt-in `skip_invalid` removes only invalid SL/TP fields and records the reason.
10. Full close persists `closed_at`, zero remaining lots, and preserves opening broker identifiers/fill; missing management fill must remain absent and never become `0`.
11. Reconnect/restart/replay reconciliation proves broker success is repaired in state without resending the broker action.
12. Operation journal evidence is present and sanitized; journal failure never changes execution/delivery behavior.
13. AI-dependent ambiguous/narrative examples must show a successful real provider attempt or an intentional deterministic/fail-closed fallback; transport/provider failures are release blockers for AI-dependent behavior.
14. LIVE remains off throughout the entire matrix.

## Telegram copied-channel semantics

A configured Telegram channel is authoritative as a **source feed for the message that exists in that channel**, regardless of whether another copier originally copied the text there from a different channel. Mkety does not need the upstream origin in order to forward/process the new posted message.

Important consequences:

- Self-authored/copier-authored channel posts must not be dropped merely because Telethon marks them `out=True`.
- If the upstream copier preserves a real Telegram reply relationship in the configured source channel, Mkety must preserve that reply coordinate through ingestion, management correlation, and Telegram destination delivery.
- If the upstream copier posts reply text as a fresh standalone message and does not preserve Telegram reply metadata, Mkety must not guess a reply target. Normal no-reply correlation rules apply and ambiguity fails closed.
- Telegram edits are separate source revisions and require explicit edited-message reception from the MTProto client.

## September 17 production evidence

Before the final MTProto/AI stabilization pass:

- `telegram:-1003902892609:318` (`gold buy`) opened real DEMO positions successfully on both MT5 and cTrader and sent successfully to the Telegram destination.
- Production Telegram destination message IDs 5, 6 and 7 were created successfully from source messages 318-320.
- `TP1 HIT ✅` and `SL at BE NOW` from `-1004387586337` parsed deterministically as MANAGEMENT; because reply lineage was absent and multiple targets existed, they correctly failed closed with `AMBIGUOUS_MANAGEMENT_TARGET` instead of guessing.
- Chat `-1002366787615` was active in `source_feeds`, present in `source_connections.config.allowed_chat_ids`, and had an active healthy Telegram route, but produced no `trading_events`. Root cause was external MTProto reception semantics: self-authored/copier-authored events could be dropped by the `out=True` filter.
- PR #102 fixed the production external MTProto adapter to accept intended self-authored source posts and explicitly subscribe to Telethon NewMessage and MessageEdited events; Trading V1 CI #2950 passed.
- AI-dependent events 319/320 exposed a separate Cloudflare Worker transport defect: the provider diagnostic reported `Illegal invocation` before the network request. The final AI stabilization branch adds a regression and fixes fetch receiver binding without changing provider/trading authority.

## LIVE transition rule

Do not enable LIVE merely because CI, deployment, or one DEMO order succeeds. LIVE becomes eligible only after new post-deploy production DEMO evidence covers the critical source/reply/edit/management/broker/destination/recovery rows above and the final safety audit still shows all LIVE gates disabled. Enabling LIVE is a separate deliberate authorization and rollout step.
