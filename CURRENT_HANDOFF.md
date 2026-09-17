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

## Late production verification and fixes — 2026-09-17

This section is cumulative. Do not remove or split these findings into scattered handoffs; append later production fixes and acceptance evidence here.

### Production version and safety preflight

- Production `main` before this fix stream was `ccd6c1b8a50e0f4107a075a69ef13823456adda0` (merged PR #108).
- Production Cloudflare Deploy #95, Trading V1 CI #2970 and Production Frontend E2E #100 were green for that head.
- Fresh Supabase safety re-query during this investigation showed `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`.
- cTrader DEMO `48685071` and MT5 DEMO `213921698` remained execution-enabled with LIVE disabled.
- cTrader LIVE `48681337` remained `execution_enabled=false` and `live_execution_enabled=false`.
- LIVE was not enabled or modified during this investigation.

### AI production verification — passed

The post-PR #104 AI transport fix is now verified with fresh production evidence, not only CI:

- multiple real events produced OpenAI `gpt-5.6-luna` provider attempts with HTTP `200` and `SUCCESS`;
- `Move SL to entry` showed a successful provider call at approximately 1602 ms even though the semantic result was rejected by the interpreter;
- narrative/incomplete signals including `GBPUSD buy at market without stop loss and take profit / It will be updated later` and `Let trade gold now we are going long, we will monitor and set SL and tp in a bit` also produced successful provider attempts and real DEMO execution where interpretation was actionable;
- no fresh `Illegal invocation` occurred after the fetch-binding deployment.

AI transport/provider health is therefore no longer the current blocker. Semantic handling of particular phrases remains deterministic authority.

### `-1002366787615` source and Gold VIP route — verified

The recent `-1002366787615` traffic is not entering through the borrowed external MTProto connection. It uses the normal Telegram Bot API source connection `Telegram VIP signal copier source` (`fe1e9e48-6474-4fbf-90eb-327f392d63bf`).

Current routing is correct and must not be duplicated:

- source feed `-1002366787615` is active;
- connection-level route `telegram route main` is active;
- destination is `telegram real vip2` (`092ad2f5-4be1-40c9-b61d-53cc79d99633`);
- destination chat is `-1003928022251`;
- destination is active/healthy;
- formatting mode is `none` (forward-as-is).

Therefore Telethon cannot explain delivery loss for this Bot API source.

### Raw Telegram reply suppression — confirmed Mkety defect and fix

Real source event `-1002366787615:2460` with text `We go again` reached Mkety, was interpreted safely as non-actionable/needs-review, selected the correct Gold VIP Telegram destination, but failed delivery with `TELEGRAM_REPLY_PARENT_UNRESOLVED` because it was a reply to source message `2459` and no mapped destination parent existed.

For `formattingMode=none`, this violated the forward-as-is requirement: raw content should not disappear solely because reply threading cannot be recreated.

PR #109 changes raw-mode behavior only:

- if a Telegram reply parent is mapped, preserve the real reply;
- if a reply parent is missing in raw `none` mode, send the message standalone rather than dropping it;
- record `replyParentFallback=true` in the successful delivery evidence;
- edit behavior remains strict: an unresolved source edit mapping still fails instead of posting a duplicate standalone message;
- non-raw modes retain strict unresolved-parent behavior.

A RED regression was committed first and Trading V1 CI #2971 failed before implementation as expected.

### Upstream missing-message evidence — external capture remains a separate issue

Two distinct upstream gaps were observed:

1. Bot API source `-1002366787615`: event `2460` (`We go again`) contains a genuine reply pointer to message `2459`, but source message `2459` is absent from `trading_events`. The Bot feed existed and was active hours before event 2460. Mkety's Bot webhook does not filter trading vs non-trading text and accepts normal/channel posts, replies and edits; the missing parent therefore did not disappear in the trading parser.
2. Borrowed external MTProto source `-1003902892609`: event `333` (`Close`) contains a genuine reply pointer to Telegram message `332`, but source message `332` is absent from `trading_events`. Event 333 reached Mkety and failed broker correlation as `NO_REPLY_TARGET`. This proves a real capture gap upstream of Mkety's canonical ingestion for at least one MTProto source message.

The repository's current external adapter accepts outgoing/self-authored posts and subscribes to `NewMessage` and `MessageEdited`, but production source identity `spf2` is a separate external process and there is no repository-controlled restart/deploy endpoint or stored host access proving what exact listener code is running there. Do not claim the exact upstream cause is known until the borrowed listener/process itself is inspected. The evidence establishes that Mkety never received message 332; it does not yet distinguish an upstream Telethon sender/outgoing filter from another listener/network/drop condition.

### SL/TP destructive replacement — confirmed broker-state defect and fix

Real DEMO position evidence confirmed the reported behavior on cTrader position `138453790`:

- one management update produced TP `4408` while SL was absent;
- a later edit of the same source signal to include `SL 4200` resulted in the same broker position containing SL `4200` while TP disappeared.

Root cause: partial `MODIFY_POSITION` actions sent only the changed protective field. Both cTrader amendment semantics and MT5 `TRADE_ACTION_SLTP` can treat an omitted sibling protection as empty/zero rather than "leave unchanged".

PR #109 fixes this at canonical action construction:

- SL-only management now sends the desired new SL plus the currently persisted TP;
- TP-only management now sends the desired new TP plus the currently persisted SL;
- break-even/target-protection changes preserve existing TP;
- explicit SL removal preserves TP;
- explicit TP removal preserves SL;
- source-edit protection updates emit the complete desired final SL/TP state for each affected leg;
- explicit removals remain explicit and are not inferred from omission.

Regression coverage was written before implementation for SL-only, TP-only and source-edit protection preservation.

### Relative pip management safety defect — fixed fail-closed

Real source event `telegram:-1003902892609:345` contained `Set SL 15 pips / And tp 30 pips`. The old deterministic management parser interpreted `15` as an absolute SL price, causing cTrader `TRADING_BAD_STOPS` and MT5 invalid-stop rejection.

Until symbol/broker-specific pip-distance conversion has an authoritative price context, explicit relative `pip/pips` SL/TP instructions now fail closed with `RELATIVE_PIP_PROTECTION_REQUIRES_PRICE_CONTEXT` instead of sending the pip count as a broker price. The raw Telegram destination remains independent and may still forward the source text.

### `Move SL to entry` semantic defect — fixed deterministically

Real event `telegram:-1003902892609:335` replied to the intended open trade with text `Move SL to entry`. OpenAI transport succeeded with HTTP 200, but the old interpreter returned `NEEDS_REVIEW` because this common wording was not a deterministic management alias.

A RED regression was added first. The phrase now maps deterministically to `MOVE_SL_TO_BE`, alongside existing BE/break-even aliases, so it does not depend on AI for this clear management instruction.

### Message timeline observations

Important production examples from the same test window:

- `Buy EURUSD`, `Buy gold now`, `Buy gold again`, the GBPUSD no-SL/TP signal and the natural-language GOLD long signal all reached canonical ingestion; actionable cases reached intended DEMO brokers.
- non-trading/narrative text such as the GOLD explanation reached the raw Telegram destination successfully despite interpretation being `NEEDS_REVIEW`, confirming that `formattingMode=none` is not supposed to require a valid trading signal.
- `Tp hit` also reached the raw Telegram destination even though trading interpretation remained non-actionable.
- `Close` event 333 was correctly not executed because its genuine reply target message 332 was never received by Mkety; guessing a destructive close target remains prohibited.

### Active implementation/verification

- Fix branch: `fix/raw-forward-protection-preservation-20260917`.
- Draft PR: #109, `Preserve Telegram raw replies and broker SL/TP state`.
- Initial RED regression head: `4917bb18ea437ae31284c9f07caaf20a49ab5ec5`; Trading V1 CI #2971 failed as expected before implementation.
- Additional `Move SL to entry` RED checkpoint: `e7668ed57e8a891345d15f057fb83664e7e791e8`; Trading V1 CI #2976 failed as expected before the alias implementation.
- Current implementation head at the time of this handoff update: `e6b1a027bb081315fc65b922d985c9d804719611`.
- Do not merge/deploy until Trading V1 CI is green on the exact final PR head. After merge, verify Production Cloudflare Deploy and frontend/readiness checks on the exact main SHA, then re-query LIVE controls/accounts.

### Post-deploy real DEMO acceptance still required

After PR #109 is merged/deployed, use new real messages—not replays of old failures—to prove:

1. raw `none` mode forwards an ordinary standalone message;
2. a raw reply with a mapped parent replies to the mapped destination message;
3. a raw reply with a missing parent still arrives as a standalone destination message and records the fallback;
4. a signal without SL/TP followed by SL-only, TP-only and combined protection updates preserves both fields correctly on cTrader and MT5;
5. `Move SL to entry` moves the correct replied-to position to BE while preserving TP;
6. relative-pip protection wording does not execute unsafe absolute values;
7. source edits continue to edit the mapped Telegram destination rather than create duplicates;
8. the external `spf2` process is inspected or fresh sequence evidence proves whether the upstream missing-message gap is resolved;
9. final safety audit again proves every LIVE gate/account remains disabled.
