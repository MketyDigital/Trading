# Current Development Handoff

Read root `AGENTS.md` first. This file is the newest continuation authority. Older handoff content is preserved in repository history and dated handoff/spec/plan documents.

## Production authority — 2026-09-17

Current production `main` includes the completed deterministic revision/protection/Operations work plus the two production fixes found during real DEMO observation.

### Merged release chain

- PR #101 merged and deployed: deterministic revisions, protection policy, Telegram destination lineage, AI provider authority/diagnostics/health, normalized operation journal, customer/staff Operations, durability regressions, migrations 0039–0042.
- PR #102 merged at `1c3d216e3d25966cfce39b35eda410e2b9e7e419`: external MTProto source reception now accepts intended self-authored/copier-authored source posts and explicitly subscribes to Telethon `NewMessage` and `MessageEdited`, so genuine reply/edit lineage can reach Mkety. Exact PR head `df150cb4e18b8b204fc45ea7778cfb4235893512`; Trading V1 CI #2950 passed.
- PR #104 merged at `ddbf028ab5e71f092c168f4813c6562fda456972`: fixes Cloudflare Worker AI `fetch` receiver binding that caused `Illegal invocation` before provider requests, and establishes real-production DEMO acceptance authority. Trading V1 CI #2957 passed; Production Cloudflare Deploy #91 passed.

### Real production DEMO is the acceptance authority

Use `docs/REAL_PRODUCTION_DEMO_ACCEPTANCE_2026-09-17.md` as the release test authority.

Acceptance means new real production DEMO traffic through the same path customers use:

Telegram source -> persisted source/feed authority -> event ingestion -> deterministic/AI interpretation -> correlation/management -> persisted routes -> Telegram/cTrader/MT5 destinations -> durable state -> Operations evidence.

Legacy staging Gate 6/Gate 7 workflows are optional diagnostics only. Missing staging secrets do not block release when the real production DEMO path is available and verified. They never authorize LIVE by themselves.

### Verified real production DEMO evidence

Before the final MTProto/AI fixes:

- `telegram:-1003902892609:318` (`gold buy`) opened real DEMO positions successfully on both MT5 and cTrader and sent successfully to the Telegram destination.
- Telegram destination source messages 318–320 produced destination message IDs 5, 6 and 7 successfully.
- `TP1 HIT ✅` and `SL at BE NOW` from `-1004387586337` parsed deterministically as `MANAGEMENT`; because their genuine Telegram reply lineage was missing and multiple targets existed, correlation correctly failed closed as `AMBIGUOUS_MANAGEMENT_TARGET` instead of guessing.
- Feed `-1002366787615` was active, present in the DB source allowlist, and had an active healthy Telegram destination route, yet produced no `trading_events`. The external adapter's `out=True` filtering explained how copier/self-authored posts could look normal in Telegram but be dropped before ingestion.
- AI-dependent source messages 319/320 failed before network dispatch with Cloudflare `Illegal invocation`; the error was traced to unbound global `fetch`, not to the persisted OpenAI model/key path. PR #104 fixes that transport seam.

### Copied-channel / reply semantics

A configured Telegram channel is authoritative for the message that exists in that channel, regardless of where another copier originally obtained it.

- A post copied/reformatted into a configured source channel should be processed normally even though that channel is not the original upstream source.
- Self-authored/copier-authored posts must not be dropped merely because Telethon marks them `out=True`.
- If the upstream copier preserves a real Telegram reply relationship in the configured source channel, Mkety must preserve that reply coordinate through trading correlation and Telegram destination delivery.
- If the upstream copier flattens reply text into a standalone post with no Telegram reply metadata, Mkety must not guess a reply target; normal safe no-reply correlation applies and ambiguity fails closed.
- Telegram edits are revisions of the same logical source message and require edited-message reception. They must not create duplicate opens.

### Existing functionality remains intact

These fixes are additive. Existing source authorization, feed-scoped routing, deterministic parsing, bounded AI/fallback, reply priority, guarded no-reply management, BE/TP/partial/full-close/pending-cancel semantics, Telegram formatting/templates, Telegram send/reply/edit mapping, cTrader/MT5 fanout, broker idempotency, revision idempotency, durable position state, reconnect/reconciliation, protection policy, Operations evidence and secret isolation remain authoritative.

Strict invalid-protection rejection remains the compatibility default. `skip_invalid` remains opt-in. Missing fields are not ambiguity. Ambiguous/conditional/contradictory intent remains fail-closed.

### Current production safety posture

Post-PR #104 deployment re-query confirmed:

- `trading_access_enabled=true`;
- `broker_execution_enabled=true`;
- `live_broker_execution_enabled=false`;
- cTrader DEMO `48685071`: `execution_enabled=true`, `live_execution_enabled=false`;
- MT5 DEMO `213921698`: `execution_enabled=true`, `live_execution_enabled=false`;
- cTrader LIVE `48681337`: `execution_enabled=false`, `live_execution_enabled=false`.

LIVE has not been enabled.

### Remaining release gates before first LIVE test

Do not enable LIVE until new post-fix production traffic proves the critical rows below:

1. a new message from `-1002366787615` is ingested and forwarded on its active Telegram route;
2. a genuine Telegram reply arrives with non-empty reply lineage, correlates to the intended original trade when it is management, and replies to the corresponding mapped Telegram destination message;
3. an edited source message arrives as a revision with non-empty edit lineage, does not create another OPEN, and edits the mapped Telegram destination message rather than sending a duplicate;
4. a new AI-dependent/ambiguous message produces a successful provider attempt after PR #104, with no `Illegal invocation`;
5. replay/idempotency, protection-skip/strict behavior, partial/full close durability and reconciliation remain clean on the observed production path;
6. re-query runtime controls/accounts immediately before LIVE and confirm every LIVE gate/account is still disabled.

Operational caveat: the active source connection is `external_mtproto` with external identity `spf2`. Its DB health fields are non-authoritative and there is no persisted restart endpoint. PR #102 changed the external Python adapter, so production reply/edit/copied-post acceptance is not considered passed until fresh real events prove that the external `spf2` process is actually running the new adapter code.

### LIVE transition

The user has authorized progression toward LIVE only after the real production DEMO gates pass. The first LIVE test must be narrow and deliberate: one intended LIVE account, smallest supported exposure, exact authorized source/route, fresh preflight, and immediate post-test safety/state verification. Never enable LIVE merely because CI/deployment succeeds.
