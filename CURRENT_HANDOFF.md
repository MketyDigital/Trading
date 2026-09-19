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

### Final PR #109 verification and production deployment checkpoint

This checkpoint supersedes only the earlier in-progress verification wording above; all earlier investigation evidence remains preserved.

- A deeper RED regression was added after the first protection fix: a compound `MOVE_SL` + `CHANGE_TP` command emitted two sequential broker amendments, where the second amendment could restore the old sibling protection and undo the first.
- RED checkpoint head `6098909200ef57cb053f8b5bb3aa01bcb6a36a8d` failed Trading V1 CI #2979 exactly because the expected one final-state protection amendment was instead two conflicting amendments.
- Commit `e6f7e7a0106587d8e335524966c0d2c2e78e5240` changed protection-only `COMPOUND` management to calculate the final SL/TP state per open leg and emit one `MODIFY_POSITION` per affected leg. Mixed compounds such as partial-close plus BE retain their existing ordered behavior.
- Commit `ddd63eb3e1ce7dec08e88d91f576503de517cfb4` updated the compatibility expectation so SL changes explicitly preserve each leg's existing TP.
- Trading V1 CI #2981 passed on the exact final PR code head: all 360 Worker test files passed, all 14 MT5 bridge tests passed, all 11 internal MTProto-listener tests passed, and all 32 external MTProto-adapter tests passed.
- PR #109 was merged into `main` as `cc60f356920f32681e93346789bea030491115e9`.
- Main Trading V1 CI #2982 passed on the merged commit.
- Production Cloudflare Deploy #96 passed on the merged commit using the configured repository/environment production secrets: Cloudflare authentication, production dry-run, Worker deployment, production health probe, persisted owner broker-switch verification and production safety-posture recording all completed successfully.
- Immediate post-deploy Supabase re-query confirmed `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`; cTrader LIVE `48681337` remains `execution_enabled=false` and `live_execution_enabled=false`; DEMO cTrader `48685071` and DEMO MT5 `213921698` remain LIVE-disabled.
- No LIVE gate or LIVE account execution permission was enabled by this release.

PR #109 is therefore deployed to production code. Real production DEMO behavior still requires fresh source messages for the acceptance cases listed immediately above; do not infer those real-message rows solely from CI/deploy success.

### Second management-state / policy hardening checkpoint — PR #110

Fresh post-PR #109 DEMO observation proved the remaining SL/TP replacement defect was deeper than action construction. Successful broker `MODIFY_POSITION` calls were not consistently materialized back into durable `position_legs.stop_loss` / `position_legs.take_profit`. A later SL-only or TP-only instruction therefore read stale `NULL` protection state and could still erase the sibling field at the broker even though the action builder attempted to preserve it.

PR #110 fixes the complete persistence chain:

- the production execution coordinator now binds every successful lifecycle-changing action that requires durable state, including successful `MODIFY_POSITION` responses that return only success and no fresh broker identifiers/fill;
- the production trade-state binder now carries desired `stopLoss`, `takeProfit`, `clearStopLoss` and `clearTakeProfit` values;
- the durable trade-state store applies protection updates and explicit clears to the affected leg instead of leaving stale/null protection materialization;
- group-level SL state is realigned when all open legs share the same stop, and explicit full SL removal clears the group stop only when all open legs are clear;
- ordinary OPEN bindings remain backward-compatible and do not add meaningless null/false protection fields.

The RED regression run failed on exactly these missing seams before implementation: missing protection fields in binder payload, clear-SL not nulling durable state, successful MODIFY with `{ok:true}` not being persisted, and unsafe no-reply newest-trade guessing. The final branch head `f382864008bf63a128d98eda8aa05d8f3015d0b3` passed Trading V1 CI #2998 before merge.

Break-even semantics were also verified directly. `MOVE_SL_TO_BE`, `SL at BE`, break-even aliases and `Move SL to entry` use the original entry price as the target stop. Eligibility allows any actual favorable move beyond entry — even a very small positive move — while equality at entry is not considered positive movement. Broker-side minimum-distance/stop rules remain authoritative, so Mkety does not force an invalid stop when the broker says BE cannot yet be placed.

No-reply management is now intentionally safer. The old `RECENT_ACTIVE_TRADE` fallback that could select the newest of several unrelated logical trades has been removed. Management priority is now explicit reply -> broker identity -> explicit thread -> explicit symbol -> safe source-message continuity -> one unique active logical trade. When more than one unrelated logical trade remains plausible, Mkety fails closed with `AMBIGUOUS_MANAGEMENT_TARGET` instead of guessing. A single logical trade represented by both cTrader and MT5 groups still fans out to both accounts.

Reply behavior was regression-tested for repeated management replies. Two or more separate Telegram replies to the same original source signal continue to resolve through `REPLY_TARGET` to the same logical trade and its sibling account groups; replying once does not consume or invalidate the original source lineage.

Fast entry is now a locked platform behavior rather than an optional account negotiation. Runtime account normalization always treats fast entry as `{ "enabled": true, "mode": "execute_immediately", "locked": true }`, and legacy rows that previously contained `{}` or `wait_for_complete_signal` no longer delay a fast/incomplete entry. There is intentionally no frontend off switch.

Entry-zone policy is now canonical and executable for range entries. Existing/invalid empty policies normalize to `{ "mode": "market_if_inside" }`. Supported frontend modes are `market_if_inside`, `midpoint`, `lower`, `upper`, and `market_only`. When real market price is available, range materialization follows the chosen account policy; legacy range planning remains compatible when a market price is unavailable.

The real enterprise account frontend now exposes account-level controls for existing connected brokers:

- Automatic TP protection shows current ON/OFF state and can be enabled or disabled through the existing persisted safety policy;
- Fast entry is displayed as `Always on` and has no toggle;
- Entry-zone policy has a real persisted selector/save action;
- fixed lot remains editable as before.

Migration 0043 (`account_entry_and_fast_policy_normalization`) was applied directly to production Supabase after merge because the Cloudflare production workflow deploys Worker code but does not apply database migrations. Production account verification after migration shows:

- cTrader DEMO `48685071`: `autoTpProtection=true`, fast entry `execute_immediately/enabled/locked`, entry zone `market_if_inside`, LIVE disabled;
- MT5 DEMO `213921698`: `autoTpProtection=true`, fast entry `execute_immediately/enabled/locked`, entry zone `market_if_inside`, LIVE disabled;
- cTrader LIVE `48681337`: execution remains disabled, LIVE remains disabled, fast entry normalized and entry zone normalized without enabling execution.

PR #110 merged into `main` as `0594c35a864a716653365e411aed56c0366ada91`. Main Trading V1 CI #2999 passed. Production Cloudflare Deploy #97 passed the exact merged code through production credential validation, Cloudflare authentication, dry-run, Worker deployment, health probe, persisted broker-switch verification, secret cleanup and production safety-posture recording.

Immediate post-deploy Supabase verification still shows `trading_access_enabled=true`, `broker_execution_enabled=true`, and `live_broker_execution_enabled=false`. The cTrader LIVE account remains `execution_enabled=false` and `live_execution_enabled=false`. No LIVE execution permission was enabled by PR #110 or migration 0043.

Fresh real-production DEMO acceptance is still required before treating the behavioral rows as proven end-to-end. The next acceptance sequence should prove:

1. open one DEMO trade without protection, set SL only, then TP only, then SL again, then TP again, then both together; cTrader and MT5 plus `position_legs` must retain the complete final SL/TP state after every step;
2. explicit SL removal preserves TP, and explicit TP removal preserves SL, with durable state matching the broker;
3. a BE phrase while price is only slightly favorable sets SL exactly to original entry when broker stop rules permit and keeps TP intact;
4. no-reply management with one logical trade targets both intended DEMO account groups;
5. no-reply management with two unrelated plausible trades fails closed as ambiguous;
6. two or more replies to the same original signal all continue targeting that same logical trade without duplicate OPENs;
7. the production account frontend round-trips Auto TP and entry-zone changes for existing DEMO accounts, while fast entry remains visibly locked on;
8. a real range-entry signal demonstrates the selected entry-zone mode at execution;
9. every final acceptance check re-confirms all LIVE controls/accounts remain disabled.

### Bounded recent no-reply correction — PR #111

The blanket removal of `RECENT_ACTIVE_TRADE` in PR #110 was too strict for a common operational sequence: a trader can open a fresh signal, change their mind seconds later, and send a bare management command such as `Close` without replying or naming the symbol while older unrelated positions are still running.

PR #111 restores that useful behavior with a narrower safety rule:

- explicit reply, broker identity, Telegram thread, explicit symbol and source-message continuity still retain higher priority;
- when those stronger coordinates are absent and multiple logical trades are open, Mkety may target the newest logical trade only if that trade was opened inside the configured short correlation window and is clearly separated from the runner-up by the recency gap;
- the current recency separation threshold is 5 seconds, matching the previously established guard;
- if two different logical trades were opened within that same short interval, management remains `AMBIGUOUS_MANAGEMENT_TARGET` and no destructive broker command is guessed;
- recency is based on trade opening time (`createdAt`), not `updatedAt`, so later SL/TP edits or other management on an old running trade cannot make that old trade appear newly opened;
- a single logical trade fanned out across cTrader and MT5 remains one cohort and can still be targeted across both accounts.

RED-first evidence: test-only commit `29f4d4e0b4866ae7f5022b93baa9c5300ef088f4` failed Trading V1 CI #3000 because the fresh newest trade was still rejected as ambiguous. Implementation head `bf9b67d2287aad7b91df4f4c1831d835d4e5e9ae` then passed Trading V1 CI #3001, including regression coverage for fresh newest targeting, same-short-interval ambiguity, and protection against old trades becoming recent through later updates.

PR #111 merged to `main` as `fbac2cd28982a8b7db3af6e11c20665492a10624`. Main Trading V1 CI #3002 passed and Production Cloudflare Deploy #98 passed the exact merged code through production dry-run, Worker deployment, health probe and persisted safety verification.

Immediate post-deploy Supabase verification confirms `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`. DEMO cTrader `48685071` and DEMO MT5 `213921698` remain execution-enabled but LIVE-disabled; cTrader LIVE `48681337` remains `execution_enabled=false` and `live_execution_enabled=false`. No LIVE permission was enabled by PR #111.

Updated acceptance expectation: with an older Gold trade still running, a newly opened EURUSD trade followed seconds later by bare `Close` should target the fresh EURUSD logical trade when it is clearly newer than the older trade. If Gold and EURUSD were both opened within the same short recency interval, the same bare `Close` must fail closed as ambiguous. Fresh real DEMO traffic should verify both branches before first LIVE use.

### Fast-entry full-signal promotion hardening — PR #112

Fresh real-production DEMO traffic on 2026-09-18 exposed a critical fast-entry completion gap. The fast/incomplete signal itself could open correctly, while the later complete signal containing entry zone, SL and multiple TPs parsed correctly but failed to materialize onto the already-open position.

Confirmed production examples:

- V10(1s): `telegram:-1001822170589:24185` (`V10(1s) Sell Now!!!`) opened the fast trade. Full signal `24186` was a genuine Telegram reply, parsed READY/complete, correlated as `REPLY_TARGET`, but the orchestrator treated any matched READY signal other than literal `FAST_ENTRY_COMPLETION` as terminal `CORRELATED` and emitted zero broker actions.
- V75: `24198` (`V75 index Buy Now!!!!`) opened the fast trade. Full replied signal `24199` suffered the same `REPLY_TARGET -> CORRELATED -> zero actions` defect. Because the full signal was never attached to the position group's `sourceEventIds`, later replies `24202` / `24203` / `24204` / `24205` (TP1/TP2/TP3 and partial-close+BE management) all failed with `NO_REPLY_TARGET`.
- XAUUSD: `telegram:-1003902892609:364` (`Gold buy`) opened successfully on cTrader and MT5. Full signal `365` correlated as `FAST_ENTRY_COMPLETION` but produced no executable production account plan. Production-like fixed-lot fallback regression coverage proves the core three-target completion planner itself is executable, so this historical row does not justify weakening protection or lot constraints.
- Newest XAUUSD test: `telegram:-1004387586337:920` (`GOLD BUY`) opened successfully on both DEMO brokers. Immediate next full signal `921` parsed correctly but failed as `AMBIGUOUS_FAST_ENTRY_COMPLETION` because older incomplete XAUUSD BUY groups were still inside the generic completion window. This proves generic symbol/side recency is insufficient when the source sequence itself identifies the intended fast signal.
- Bot-copy source `-1002366787615:2464` / `2465` forwarded successfully to Telegram but had no routed broker execution on that source path; do not confuse its Telegram copy behavior with the external-MTProto broker-route failure above.

PR #112 fixes both confirmed completion seams without broad guessing:

1. A complete READY signal that is already matched by a genuine reply/thread coordinate can promote an existing fast-entry group even when the correlation reason is `REPLY_TARGET`, provided every matched group is still `incomplete=true` and symbol + side exactly match the complete signal. A mismatch remains non-promoting/fail-closed.
2. For a non-reply complete signal, fast-completion correlation now checks immediate Telegram source-message continuity before the broad symbol/side completion window. If the immediately previous Telegram message belongs to one compatible incomplete logical trade, that cohort is selected as `FAST_ENTRY_COMPLETION`. If source continuity is not unique, ambiguity remains fail-closed.
3. Completion reconciliation retains the original fast broker position as target 1, modifies that existing position with final SL + TP1, opens only the additional TP legs, marks the desired group complete, and appends the full signal's source event ID so all later genuine replies to the full signal can resolve normally.

TDD / verification evidence:

- Initial RED commit `fe9c96bba08dd0722d6e60cdb8607483aa06a622` reproduced the replied-full-signal zero-action defect; Trading V1 CI #3003 failed as expected before implementation.
- Replied completion implementation commit `e061d2b8927f72f1cf38c84bda338e31885838d4`.
- Production-like XAUUSD fixed-lot / three-target compatibility test commit `dd6b994fcf8e71872226c4c98fdd60dae3c88898`; Trading V1 CI #3005 passed.
- Adjacent-source ambiguity RED commit `031e6259399ad8b78ee8fc84adc03926c3177a75`; Trading V1 CI #3006 failed as expected before the continuity fix.
- Source-continuity implementation commit `918dadd401396857ba3a76623cec77edb04577dd`; Trading V1 CI #3007 passed all Worker/trading-core, MT5 bridge, internal MTProto and external MTProto test stages.

Other fresh production findings from the same audit:

- `Buy CADJPY now` followed seconds later by bare `Close` worked end-to-end through source-message continuity and closed both intended DEMO broker copies.
- Correct `Sell NZDUSD @0.57199` opened on both DEMO brokers.
- `TP: 0.5500` replied through the NZDUSD chain and succeeded on both brokers.
- Initial `SL: 0.5680` for that SELL is below the ~0.57199 entry and therefore represents profit-side/invalid stop geometry for a SELL; broker rejection of that original instruction is not evidence that valid SL management is broken.
- Typo symbol `NZDUSS` did not execute, as expected.
- AI transport remains healthy: Bot-source `BUY XAUUSD` produced a successful OpenAI `gpt-5.6-luna` HTTP 200 provider attempt.
- Raw Telegram forwarding continues independently of trading executability on routes configured for Telegram delivery.

Real production DEMO acceptance is still required after PR #112 is deployed. The critical acceptance sequence is: send a new fast signal, verify both intended DEMO broker positions open, then send the complete signal both as (a) a genuine reply and (b) an immediate next same-channel message in separate tests. Verify the existing first broker position receives final SL+TP1, only additional target legs are opened, group `incomplete` becomes false, both fast and full source event IDs are retained, and later TP/BE/partial-close replies to the full signal target that same logical trade. Re-confirm all LIVE gates remain disabled throughout.


#### PR #112 merge / production deployment checkpoint

- PR #112 final reviewed head `317bcdfe93481b086e0f8814f97d84274d442820` passed Trading V1 CI #3008 before merge.
- PR #112 merged into `main` as `43ad9f24e49d8d4c518203dc6aebad520129fb8c`.
- Main Trading V1 CI #3009 passed on the merged commit.
- Production Cloudflare Deploy #99 passed on the merged commit: production credential checks, Cloudflare authentication, final dry-run, Worker deployment, production health probe, persisted broker-switch verification, secret cleanup and safety-posture recording all completed successfully.
- Immediate post-deploy Supabase verification confirmed `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`. DEMO cTrader `48685071` and DEMO MT5 `213921698` remain execution-enabled but LIVE-disabled; LIVE cTrader `48681337` remains execution-disabled and LIVE-disabled. Fast entry remains locked `execute_immediately`.
- No LIVE permission was enabled by PR #112.
- CI/deployment proves the code path is released, but the fast -> complete -> later-management behavior still requires a fresh real DEMO source sequence to count as end-to-end accepted.


### Native fast-entry completion regression root cause and restoration — PR #113

The operator correctly identified that fast -> full follow-up worked before the September stabilization updates and then regressed. The regression was not caused by the broker promotion algorithm itself. It was caused by two independently reasonable changes interacting with an older correlation/orchestration assumption.

Historical chain:

- Before the September 15 reply-integrity work, external/hosted MTProto did not always preserve Telegram reply identity into the canonical event. A visually replied full signal could therefore arrive without `reply_to_event_id` and fall through to generic fast-completion inference. The correlator emitted `FAST_ENTRY_COMPLETION`, which the orchestrator knew how to execute.
- On 2026-09-15, reply-integrity commits including `89b522fc5ce40e4a2cfd1002ffdf37b6aef4230e` and `8fcbc31237882e15c7c961dfcaccb76f9ffb9b9f` correctly started preserving hosted/external MTProto reply identity.
- The correlator still handled READY signals with reply/thread metadata before the fast-completion block and labeled them `REPLY_TARGET` / `THREAD_TARGET`.
- The V1 orchestrator intentionally executed matched READY signals only when correlation reason was `FAST_ENTRY_COMPLETION`; generic READY `REPLY_TARGET` therefore became terminal `CORRELATED` with zero broker actions.
- This is exactly what occurred in production for V10(1s) event `24186` and V75 event `24199`: both full signals were correctly parsed and correctly linked to the fast signal, but the semantic reason was wrong for broker promotion.
- The September 15 stabilization also intentionally widened inference-only fast completion from the ordinary ~2-minute recent window to a dedicated 30-minute window (`087967e91fb9154ccb813b6124a42addfe47ce8c`). This was designed to support delayed full signals, but it increased the chance that multiple stale/incomplete same-symbol trades remain eligible. That explains the later `AMBIGUOUS_FAST_ENTRY_COMPLETION` on XAUUSD. PR #112 added immediate source-message continuity to safely disambiguate the newest adjacent same-channel fast/full pair; that narrow safeguard remains useful.

PR #112 temporarily compensated downstream by allowing a generic matched READY signal to be reinterpreted as a fast completion inside the orchestrator. That restored the symptom but duplicated correlation responsibility in the wrong layer.

PR #113 restores the clean/native architecture:

1. For a complete READY signal with explicit Telegram reply identity, the correlator first checks whether the replied logical trade is still incomplete and has exact matching canonical symbol + side. If yes, correlation returns `FAST_ENTRY_COMPLETION` directly (including all broker-account groups in the same logical cohort).
2. A complete READY signal with matching thread identity follows the same rule and returns `FAST_ENTRY_COMPLETION`.
3. If a reply/thread resolves to an active trade but symbol/side/incomplete state is incompatible, correlation fails closed with `FAST_ENTRY_COMPLETION_MISMATCH`; it does not silently promote the wrong trade.
4. Unresolved explicit reply remains fail-closed; it does not fall through to inference and attach another trade.
5. The orchestrator is restored to the earlier simple contract: only `NEW_GROUP` or explicit `FAST_ENTRY_COMPLETION` proceeds into signal execution. The PR #112 generic matched-signal compensation layer is removed.
6. Existing 30-minute inference support and the PR #112 adjacent-source continuity safeguard remain. This preserves delayed full-signal support while avoiding the production ambiguity seen when an immediate next full signal follows a new fast trade.

TDD / verification:

- RED commit `35a45e750dd527cab853dfc9d39022440c6cf0c6` changed the long-standing reply/thread expectations from `REPLY_TARGET` / `THREAD_TARGET` to the intended `FAST_ENTRY_COMPLETION` semantic and added multi-account reply-cohort coverage. Trading V1 CI #3010 failed as expected before implementation.
- Source-level correlation implementation: `1dda5d8d6bf20b8d37b98a0707f2bd88c565bcfa`.
- Downstream compensation removal: `c7f8d698d0d17af41c241279b7c0a715cf7e84bc`.
- Orchestration regression realigned to native correlation: `6c8b63336c48ce2eb6b2eba8f0c05d91b7633aa5`.
- Trading V1 CI #3013 passed all Worker/trading-core, MT5 bridge, internal MTProto and external MTProto stages.

This restoration is deliberately narrow: it does not roll back reply preservation, raw Telegram forwarding fixes, SL/TP sibling-preservation fixes, source-edit handling, AI transport fixes, or broker safety controls. LIVE remains disabled and requires separate explicit acceptance.


#### PR #113 merge / production deployment checkpoint

- PR #113 final head `447869e1c3945f1441c76c8cecc4ecb7fd6a8636` passed Trading V1 CI #3014 before merge.
- PR #113 merged into `main` as `9a00559d7fb3e3573b50bfcf62e4b4e30e665c04`.
- Main Trading V1 CI #3015 passed on the merged commit, including Worker/trading-core, MT5 bridge, internal MTProto and external MTProto test stages.
- Production Cloudflare Deploy #100 passed on the same merged commit. Production credential checks, Cloudflare authentication, final dry-run, Worker deployment, production health probe, persisted broker-switch verification, temporary-secret cleanup and safety-posture recording all completed successfully.
- Immediate post-deploy Supabase verification confirmed `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`.
- DEMO cTrader `48685071` and DEMO MT5 `213921698` remain execution-enabled and LIVE-disabled. LIVE cTrader `48681337` remains execution-disabled and LIVE-disabled.
- Fast-entry policy remains locked `execute_immediately`.
- PR #113 did not enable LIVE. It restores native fast-completion semantics at correlation and removes the PR #112 downstream compensation.
- Real production DEMO acceptance still requires a new fast -> full follow-up sequence after this deployment before the behavior is considered end-to-end accepted.


### Fresh production acceptance after PR #113 + crossed-TP1 completion fix — 2026-09-18

This section is cumulative. Do not remove the prior PR #109/#112/#113 findings; this evidence refines them.

Fresh production evidence after PR #113:

- External MTProto V25(1s) fast event `telegram:-1001822170589:24228` executed successfully.
- Full replied V25(1s) event `telegram:-1001822170589:24229` correlated as `FAST_ENTRY_COMPLETION` and executed successfully.
- Persisted cTrader logical group `4bdb3f29-33a6-436d-b819-d32c3a0e64de` is OPEN and `incomplete=false`, with both source event IDs `24228` and `24229`.
- Original broker position `138489349` was retained as target 1 and modified to SL `876500` / TP1 `881500`; target-2 position `138489438` received TP2 `883500`; target-3 position `138489442` received TP3 `886000`. This is real post-PR #113 proof that ordinary fast -> full promotion is restored end-to-end without replacing leg 1.

Fresh XAUUSD SELL evidence exposed a narrower missing requirement:

- Fast event `telegram:-1004387586337:932` (`GOLD SELL`) opened cTrader DEMO position `138490038`, order `44271821`, deal `40844672`, fill `4363.78`, 0.2 lots.
- The MT5 copy of fast event `932` failed independently with `MT5_CONNECTOR_OFFLINE`; this remains an infrastructure issue separate from fast-completion semantics.
- Full event `telegram:-1004387586337:933` contained SELL range `4365-4375`, SL `4379`, TP1 `4361`, TP2 `4355`, TP3 `4335`.
- PR #113 worked at correlation: event `933` was correctly classified as `FAST_ENTRY_COMPLETION`.
- Broker planning nevertheless produced no executable account plan and broker execution became `NOT_EXECUTABLE`. The existing cTrader group stayed incomplete with only event `932`.
- Because event `933` was not persisted into the logical group, later replies `935 TP1 HIT`, `936 SL at BE NOW`, and `937 TP2 HIT` returned `NO_REPLY_TARGET`.
- Root cause: `buildExecutionPlan()` applied ordinary new-trade protection geometry against the **current market** before `reconcilePlannedFastEntry()`. If price had already moved through TP1 before the full follow-up arrived, TP1 became invalid against current market and the entire completion was blocked before the fast-entry reconciliation layer could preserve leg 1 and continue still-valid targets.
- This exact case was already specified in the 2026-09-15 stabilization design under **Task 4: Follow-up SL/TP market-validity behavior**, but the task remained unchecked and `cloudflare-v2/tests/fast_followup_market_validity.test.mjs` did not exist. The requirement had been documented but not implemented.

PR #114 implements the missing Task-4 behavior narrowly:

- RED commit `f1da171bd35d31e8a27bd45194ed01b7f7fd849e` reproduces the real Gold geometry: existing SELL fill `4363.78`, full SL `4379`, targets `4361/4355/4335`, current market `4359`. CI #3016 failed as expected: account was `BLOCKED` instead of `READY`.
- `execution_plan.js` now accepts an optional fast-completion protection reference. Ordinary/new trades are unchanged. For matched fast completion, structural SL/TP geometry is validated against the authoritative original fast-entry price instead of rejecting the full signal merely because market has already crossed an early target.
- `v1_orchestrator.js` then checks each completion action against the fresh current market. A crossed TP on the already-open original leg is omitted rather than sent as an invalid modification; a still-valid SL can still be applied. Later target opens are kept only when their SL/TP remains market-valid. Leg 1 is never reopened/replaced.
- In the production-shaped Gold regression, expected actions are: MODIFY original position `138490038` with SL `4379` and **without** crossed TP1; OPEN only target indexes 2 and 3 with TPs `4355` and `4335`; no duplicate target 1.
- A second RED checkpoint `91fee5c620be617fc3b3eed80e3010d6cd844d30` proved fast completion was also losing the actual executed entry price (`4363.78`) and replacing it with null. That would break later BE management because `MOVE_SL_TO_BE` requires `group.entryPrice`.
- Commit `4ac1a4fe8c3a2aebc23b7b7a4c9ed24c5c523a19` preserves the original executed fast entry price and entry object through promotion.
- BE eligibility remains intentionally permissive once profitable: BUY requires fresh market strictly above entry; SELL requires fresh market strictly below entry. Even a small positive move is eligible, while flat/adverse price remains blocked.
- CI #3018 passed the crossed-TP1 implementation before the entry-preservation regression was added. CI #3019 then failed exactly because entryPrice became null. The subsequent implementation restores the entry anchor; final PR-head CI must be green before merge.
- LIVE is not enabled by this work.

Post-merge production acceptance still requires a fresh crossed-TP1 fast/full DEMO sequence. The already-failed Gold event `933` must not be replayed blindly as broker execution; use a new source sequence to validate the deployed behavior.


#### PR #114 merge / production deployment checkpoint

- PR #114 final head `381ba4eaead8c33d53b722b63221a9ab0feb2e36` passed Trading V1 CI #3021 before merge.
- PR #114 merged into `main` as `d548bb113d1fcec5fb96ce6d8a80aaf517da0bd0`.
- Main Trading V1 CI #3022 passed on the merged commit, including Worker/trading-core, MT5 bridge, internal MTProto and external MTProto stages.
- Production Cloudflare Deploy #101 passed on the same merged commit: production credentials/authentication, final dry-run, Worker deployment, production health probe, persisted broker-switch verification, temporary-secret cleanup and safety-posture recording all succeeded.
- Immediate post-deploy Supabase verification confirmed `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`.
- DEMO cTrader `48685071` and DEMO MT5 `213921698` remain execution-enabled and LIVE-disabled. LIVE cTrader `48681337` remains execution-disabled and LIVE-disabled.
- Fast-entry policy remains locked `execute_immediately`.
- PR #114 did not enable LIVE.
- The ordinary V25 fast -> full flow already has fresh production proof from events `24228/24229`. The crossed-TP1 Gold behavior implemented by PR #114 still requires a **new** real DEMO source sequence after Deploy #101 for end-to-end acceptance; do not treat the earlier failed event `933` as post-fix evidence.
- MT5 was independently offline during the fresh Gold fast event `932` (`MT5_CONNECTOR_OFFLINE`) and must be restored before dual-broker acceptance can be considered complete.


#### Fresh post-Deploy #101 acceptance — V100 fast -> full

- New fast event `telegram:-1001822170589:24239` (`V100 index Buy Now!!!`) executed successfully after PR #114 deployment.
- Full replied event `telegram:-1001822170589:24240` carried range `605.50-606.50`, SL `599.50`, TP1 `609.50`, TP2 `613.00`, TP3 `617.00`.
- Event `24240` correlated as `FAST_ENTRY_COMPLETION` and broker execution succeeded.
- Persisted cTrader group `7bf67b25-f22c-4d32-bd92-173dc8c61a95` is `OPEN`, `incomplete=false`, and contains both source IDs `24239` and `24240`.
- Original fast leg position `138501066` retained executed entry `606.08`, SL `599.5`, TP1 `609.5`.
- Added target-2 position `138501181` has SL `599.5`, TP2 `613`.
- Added target-3 position `138501189` has SL `599.5`, TP3 `617`.
- This is fresh post-Deploy #101 production proof that fast -> full promotion, original-entry preservation, and full target expansion work on cTrader after PR #114.
- Both DEMO accounts currently persist `entry_zone_policy={"mode":"market_only"}`.
- Current code semantics: entry-zone policy is applied only when canonical `entry.kind === "RANGE"`. `market_only` maps that range to `MARKET_ALWAYS`, so execution uses the current market price regardless of the supplied range. Explicit price-based pending intents (`entry.kind === "PRICE"`, e.g. LIMIT/STOP orders) bypass the range policy and keep their explicit order type/price.


### MT5 connector TLS CA hardening + OCI migration boundary — PR #115

Fresh production/operator symptom:
- Windows MT5 connector repeatedly failed before authentication with `SSLCertVerificationError: CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`.
- This failure happens during TLS establishment to `wss://cbot.mkety.com:25345/v1/mt5`, before the connection token is evaluated. The pasted pairing/reconnect token is therefore not the cause of this TLS error, but because it was exposed in chat it must be rotated/reissued before further live use.
- Git history confirms the 2026-09-16 MT5 connector change `78b3ae4b...` added deterministic `--terminal` and `--ledger` multi-instance support only; it did not change TLS behavior.
- Gateway Caddy TLS configuration has likewise not changed since the outbound MT5 work. The Windows EXE release workflow previously installed `websocket-client` but did not install/bundle a dedicated CA bundle and the connector passed no explicit CA path to `websocket.create_connection`. Frozen Python therefore depended on ambient certificate-root behavior.

PR #115 hardens the client trust path:
- RED commit `7bb1e117b44ee5f8bef8917145804bda1352999a` requires the connector transport to expose an explicit verified CA bundle. MT5 Connector Release #77 failed at pure connector tests as expected.
- Connector now imports `certifi` and `ssl`, builds explicit WebSocket SSL options with `CERT_REQUIRED`, hostname checking enabled, and `certifi.where()` as the CA file.
- Every outbound gateway connection passes those SSL options to `websocket.create_connection`.
- Windows release packaging now pins `certifi==2026.7.22` (current PyPI release verified 2026-09-19) and explicitly includes certifi data in the PyInstaller one-file executable.
- This keeps certificate verification enabled; there is no insecure `CERT_NONE` / hostname-disable workaround.
- The connector remains lightweight: one outbound WebSocket, 20-second heartbeat, 15-minute symbol refresh, one local SQLite replay ledger, and direct MetaTrader5 API use. No inbound customer VPS port is added.

OCI migration boundary for the shared cTrader/MT5 gateway:
- Keep `cbot.mkety.com` unchanged whenever possible. Move the gateway host behind the same hostname so baked MT5/cTrader WebSocket URLs do not change.
- The Docker Compose/Caddy stack is cloud-neutral despite living under `deploy/coolify`; it can run on Coolify installed on OCI without trading-code changes.
- Carry over unchanged secrets: `CBOT_TOKEN_SIGNING_KEY`, `CBOT_CONTROL_SECRET`, `CLOUDFLARE_DNS_API_TOKEN`, and ACME email. Keeping `CBOT_TOKEN_SIGNING_KEY` is essential because MT5 reconnect tokens are statelessly verified with that signing key and bound to account-row + connector-instance identity.
- Carry over `CBOT_PUBLIC_HOST=cbot.mkety.com`; keep the DNS record DNS-only, not Cloudflare-proxied, because public broker WebSockets use TCP/TLS port 25345.
- OCI must allow inbound TCP 25345 publicly to the Caddy host. Restrict SSH/management ports to administrator source IPs. Normal egress must remain available for ACME/DNS/registry operations.
- Prefer an OCI reserved public IP for the gateway host so the DNS target remains stable.
- After the OCI stack is healthy, change only the DNS A/AAAA target for `cbot.mkety.com` to the OCI reserved public IP. Let Caddy obtain/serve the certificate there, verify TLS + `/v1/cbot` + `/v1/mt5`, then retire Azure.
- If the same public hostname remains, `CTRADER_CBOT_GATEWAY_URL`, `CTRADER_CBOT_WS_URL`, baked MT5 `DEFAULT_GATEWAY`, and cBot default URL do not need code changes.
- If the gateway/control hostname changes, update GitHub production variable `CTRADER_CBOT_GATEWAY_URL` (and optional `MT5_CONNECTOR_GATEWAY_URL` if separately used), `CTRADER_CBOT_WS_URL`, and optional `MT5_CONNECTOR_WS_URL`, then redeploy Worker configuration; MT5 URLs must still normalize to `wss://...:25345/v1/mt5`.
- Caddy continues to proxy public `:25345` to internal cTrader `:25346`, MT5 `:25347`, and authenticated control routes to internal `:8790/:8791`. Do not expose 8790/8791 directly.


#### PR #115 merge / stable MT5 connector release checkpoint

- PR #115 merged into `main` as `f3c81a9d3b4fa60ac72b6816e3c4648045aa49c4`.
- Main MT5 Connector Release #82 passed completely on the merged commit.
- Verified release stages: pinned dependency install, pure connector tests, standalone Windows PyInstaller build, packaged EXE runtime smoke test, SHA256 creation, artifact upload, and stable GitHub Release asset publication.
- The stable `MketyMT5Connector.exe` release asset is therefore rebuilt with bundled certifi CA roots and explicit TLS certificate + hostname verification.
- The previously exposed MT5 connection token must be rotated/reissued before further use. Do not reuse it for live acceptance.
- No Cloudflare Worker trading code or LIVE execution gates were changed by PR #115.


### MT5 connected-state portal UX fix — PR #116

Production observation:
- Fresh MT5 connector session for account `110664480` / `FBS-Real` successfully authenticated and synced after the PR #115 TLS fix.
- Persisted account row `5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51` showed `provider_config.status=connected`, fresh broker/server identity, connector instance ID, and a synchronized symbol catalog.
- Despite that, the user portal continued rendering the generic `Sync MT5 identity` action and could show a later refresh failure as though initial setup had never completed.
- Root cause: `dashboard_mt5_connector_connections.js` injected the sync action unconditionally for every `mt5_connector` card, while `dashboard_unified_connections.js` did not render the persisted connector status/broker/server identity as a clear connected state.

PR #116 behavior:
- Connected MT5 rows now carry explicit account/provider/status data attributes from the authoritative account response.
- A persisted `mt5_connector` row with `providerConfig.status === "connected"` renders a visible `Connected` state with broker, account, server, and environment.
- Initial unsynced rows continue to show `Sync MT5 identity`.
- Already-connected rows show `Refresh MT5 connection` instead, making re-sync a maintenance/recovery action rather than implying setup is incomplete.
- After a successful MT5 sync/refresh, the shared connection manager is immediately reloaded so the card updates without requiring a manual page reload.
- A later refresh error does not erase the persisted fact that the row previously completed identity synchronization.
- Existing simplified Trading ON/OFF + live real-money controls remain intact; the implementation was adjusted to preserve their exact frontend composition contract.

TDD / CI:
- RED commit `80bd6153c1ff1678ce1a58038179627e4123cb5a`; Trading V1 CI #3023 failed as expected because the connected-state rendering did not exist.
- First implementation exposed an existing fragile exact-string composition dependency in simplified account controls and one over-specific new test; CI #3026 correctly failed.
- Composition/test boundary corrected in `7e1f9f9a4b50312ed0026d8b8da9f065df112f9a` and `335dd7dc0127d28b3e3c9cd3270273c727f33094`.
- Trading V1 CI #3028 passed Worker/trading-core tests, pure MT5 tests, and MTProto tests.
- No broker execution gates or LIVE permissions are changed by this frontend fix.


#### PR #116 merge / production deployment checkpoint

- PR #116 merged into `main` as `73657c19230ec8f39201ff49570aca79e0912638`.
- Final PR-head Trading V1 CI #3029 passed.
- Main Trading V1 CI #3030 passed all Worker/trading-core, MT5, and MTProto stages.
- Production Cloudflare Deploy #102 passed completely: credentials/authentication, SaaS configuration, temporary dual-gate Wrangler generation, production dry-run, Worker deploy, production health probe, persisted broker-switch verification without changing it, temporary-secret cleanup, and recorded safety posture.
- The production user portal now renders persisted MT5 connector setup state: connected rows show `Connected` with broker/account/server/environment and use `Refresh MT5 connection` as the maintenance action; unsynced rows retain `Sync MT5 identity`.
- Fresh FBS MT5 account row `5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51` remains persisted as connector `connected`, account `110664480`, server `FBS-Real`, environment `live`.
- Post-deploy account safety: FBS LIVE has `execution_enabled=false`, `live_execution_enabled=false`; cTrader LIVE `48681337` also has both false. Demo cTrader/MT5 remain execution-enabled and live-disabled.
- Important operator state: the persisted global `live_broker_execution_enabled` master control is currently `true` (updated before this deployment at 2026-09-18 23:11:29 UTC). PR #116 / Deploy #102 did not toggle it; the deployment explicitly preserved the persisted owner switch. Real-money execution still requires the per-account execution + live permissions, which remain false on both current LIVE accounts.


### OCI migration discovery — 2026-09-19

User requested moving only the shared cTrader/MT5 gateway from the current Azure/Coolify host to OCI while preserving Coolify and changing no trading behavior.

Read-only Coolify inspection:
- `MketyDigital/mksaas` already has a production GitHub Actions secret named `COOLIFY_TOKEN` and existing workflows authenticate to `https://deploy.mkety.com/api/v1`.
- A temporary branch-only read-only inventory workflow was created on `MketyDigital/mksaas` branch `ops/read-only-coolify-inventory-20260919`; it performs GET-only Coolify API calls and does not mutate Coolify or expose secrets.
- Coolify currently reports exactly one registered server: UUID `ynkdc4tx6bi7cyxf0kuy8kte`, name `localhost`, reachable/usable. No OCI server is registered yet.
- Current Coolify applications/databases all resolve to that same localhost server. No second/remote deployment server exists.
- The gateway itself did not appear in the sanitized `/applications` or `/services` inventory, so do not assume a Coolify application/service UUID for it until identified from the dashboard/resource detail or a more specific API endpoint.
- No OCI credentials/secrets were found in `mksaas`; infrastructure creation in OCI cannot be safely automated from the currently available credentials.

Migration boundary remains:
- Do not change cBot/MT5 application code.
- Keep `cbot.mkety.com` if possible.
- Reuse the existing cloud-neutral `ctrader-cbot-gateway/deploy/coolify/docker-compose.yml` + Caddy stack.
- Carry over unchanged `CBOT_TOKEN_SIGNING_KEY`, `CBOT_CONTROL_SECRET`, `CLOUDFLARE_DNS_API_TOKEN`, `ACME_EMAIL`, and `CBOT_PUBLIC_HOST=cbot.mkety.com`.
- OCI public ingress required by the gateway workload is TCP `25345`; internal gateway ports `25346`, `25347`, `8790`, and `8791` must not be publicly exposed.
- For Coolify management of OCI as a remote server, SSH (normally TCP `22`) must be reachable from the existing Coolify host during validation; restrict it to the Coolify/Azure source where possible.
- OCI networking has two enforcement layers: VCN NSG/security-list rules and the instance OS firewall; both must allow required traffic.
- Prefer an OCI Reserved Public IP for the gateway target.
- Safe cutover sequence: register/validate OCI server in existing Coolify -> deploy parallel gateway copy -> verify health/TLS/cTrader DEMO/MT5 DEMO -> change only DNS A/AAAA for `cbot.mkety.com` -> verify reconnect + broker identity/symbol catalogs -> keep Azure online for rollback -> retire Azure only after stable soak.

#### OCI migration topology correction + exact source/target inventory

- Correct topology: current Azure gateway and target OCI Coolify are two separate Coolify installations.
- Source Azure Coolify is accessed by `MketyDigital/Trading` production secrets `COOLIFY_URL` + `COOLIFY_TOKEN`.
- Target OCI Coolify is `https://deploy.mkety.com`, accessed by `MketyDigital/mksaas` production secret `COOLIFY_TOKEN`.
- Do not register OCI as a remote server in Azure Coolify. OCI already runs its own Coolify and appears there as server `localhost`, UUID `ynkdc4tx6bi7cyxf0kuy8kte`, reachable/usable.
- Target placement requested by user: existing OCI project `telethon`, UUID `xrhsinddvxzghzcxgwux9esj`, environment `production`, UUID `ewiwnpz3mow3lko3kiaoznbt`.
- Source Azure application discovered read-only: `Cbot Tcp gateway`, UUID `edgvi4wezjodvwqa1dpkzbt7`, status `running:unknown`.
- Source application repository `MketyDigital/Trading`, branch `main`, base directory `/`, Docker Compose location `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`.
- Source Azure env key set contains `ACME_EMAIL`, `CBOT_COMMAND_TIMEOUT_MS`, `CBOT_CONTROL_SECRET`, `CBOT_PUBLIC_HOST`, `CBOT_TOKEN_SIGNING_KEY`, `CLOUDFLARE_DNS_API_TOKEN`, and `MT5_CONNECTOR_COMMAND_TIMEOUT_MS` (Coolify returned duplicate rows for build/runtime variants). Values were deliberately not printed.
- Target deployment must be a Git-backed Docker Compose application (`build_pack=dockercompose`) created in OCI `telethon/production`, from `https://github.com/MketyDigital/Trading`, branch `main`, base `/`, compose `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`, with instant deploy disabled until environment values are migrated and checked.
- Exact Coolify API contract verified from current docs: `POST /api/v1/applications/public` accepts `project_uuid`, `server_uuid`, `environment_uuid`, `git_repository`, `git_branch`, `build_pack: dockercompose`, `base_directory`, `docker_compose_location`, and `instant_deploy`.
- Do not cut DNS or stop Azure until OCI application is configured with identical required environment values, deployed, health/TLS and both WebSocket paths verified, and DEMO connector acceptance succeeds.

#### OCI gateway staged deployment checkpoint — 2026-09-19

- User added `OCI_COOLIFY_URL` + `OCI_COOLIFY_TOKEN` to Trading production secrets.
- Created OCI Coolify application in target `telethon / production`: app UUID `p9xqtqpbljnggchy36mzd7a0`, name `Cbot Tcp gateway`, repo `MketyDigital/Trading`, branch `main`, compose `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`.
- Azure source app remains `edgvi4wezjodvwqa1dpkzbt7`; Azure was not stopped or mutated.
- Production env values were transferred source->target in GitHub Actions without printing values; target exact-value parity passed for `ACME_EMAIL`, `CBOT_COMMAND_TIMEOUT_MS`, `CBOT_CONTROL_SECRET`, `CBOT_PUBLIC_HOST`, `CBOT_TOKEN_SIGNING_KEY`, `CLOUDFLARE_DNS_API_TOKEN`, `MT5_CONNECTOR_COMMAND_TIMEOUT_MS`.
- OCI deployment UUID `gk2x4rt3kp7yqz2muuagti4l` finished successfully and target app reached `running:unknown`.
- No DNS cutover occurred; `cbot.mkety.com` still resolves/serves the Azure production gateway.
- Correct OCI origin inferred/verified from Coolify-generated sslip.io hostnames: `89.168.70.209`. Direct `curl --resolve cbot.mkety.com:25345:89.168.70.209` timed out, proving public TCP 25345 is not reachable from GitHub-hosted external probes.
- OCI Caddy logs prove the container is listening on `:25345` and serving the configured Caddy server, so the remaining 25345 reachability issue is outside the container (OCI NSG/security list and/or host firewall).
- OCI Caddy logs also show fresh ACME DNS-01 certificate issuance failing because the copied Azure `CLOUDFLARE_DNS_API_TOKEN` is stale/invalid: Cloudflare returns HTTP 403 / code 9109 `Invalid access token` while trying to create `_acme-challenge.cbot.mkety.com`.
- This stale DNS token likely did not break Azure immediately because Azure has an existing cached certificate. Do not cut over until OCI has a valid fresh certificate.
- `mksaas` production contains a separate current `CLOUDFLARE_API_TOKEN` used by Mkety production workflows. An attempted temporary automated target-token repair workflow did not start (workflow definition rejected before any job), so no Cloudflare credential was modified by that attempt.
- Next required operator checks on OCI: allow inbound TCP 25345 to origin `89.168.70.209` in the instance VCN NSG/security-list and host firewall; then repair target `CLOUDFLARE_DNS_API_TOKEN` with a currently valid Cloudflare token that has Zone Read + DNS Edit for `mkety.com`, redeploy OCI, confirm ACME certificate success, direct health + `/v1/cbot` + `/v1/mt5`, then only consider DNS cutover.
- Real trading execution controls and broker account flags were not changed by this infrastructure migration work.

#### OCI gateway certificate repair checkpoint — 2026-09-19

- `mksaas` production `CLOUDFLARE_API_TOKEN` was verified active via Cloudflare token verification.
- Only the OCI target app `p9xqtqpbljnggchy36mzd7a0` production `CLOUDFLARE_DNS_API_TOKEN` was replaced with that current token; Azure source was not modified.
- OCI gateway redeploy completed successfully after the token repair.
- Fresh OCI Caddy logs show DNS-01 authorization succeeded and a trusted certificate for `cbot.mkety.com` was obtained successfully from Let's Encrypt.
- Caddy is confirmed listening on public container port `25345` and serving the configured gateway.
- Remaining blocker before direct external acceptance/cutover is OCI network reachability: `89.168.70.209:25345` times out externally even though Caddy listens internally. Check both OCI NSG/security-list ingress and the instance host firewall.
- Required OCI ingress is stateful TCP destination `25345`, source `0.0.0.0/0` for public cTrader/MT5 clients. Do not expose internal ports `25346`, `25347`, `8790`, or `8791`.
- After port 25345 is reachable, rerun direct-origin `/health`, `/v1/cbot`, and `/v1/mt5` probes before any DNS cutover. Azure remains production and rollback target.

#### OCI gateway production cutover completed — 2026-09-19

- Cloudflare DNS pre-cutover record for `cbot.mkety.com`: A `20.57.161.98`, DNS-only (`proxied=false`), TTL 300.
- Guarded DNS cutover changed only that record to OCI origin `89.168.70.209`, preserving DNS-only mode and TTL 300.
- Public post-cutover verification using normal DNS passed immediately: `cbot.mkety.com` resolved to `89.168.70.209`; `https://cbot.mkety.com:25345/health` passed; unauthenticated WebSocket probes to `/v1/cbot` and `/v1/mt5` upgraded and returned expected `AUTH_REQUIRED` closure.
- Initial authenticated session registry check showed all account rows offline on OCI. Direct-origin comparison proved FBS MT5 LIVE row `5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51` was still online on Azure because its pre-cutover WebSocket remained open; cTrader demo/live and MT5 demo were offline on both gateways.
- Verified no operation-journal entries in the 10 minutes before forced handoff; no evidence of an in-flight broker command.
- Old Azure Coolify application `edgvi4wezjodvwqa1dpkzbt7` (`Cbot Tcp gateway`) was stopped via Coolify API with `docker_cleanup=false` to preserve easy rollback. Observed status transition `running:unknown` -> `exited:unhealthy`.
- After Azure stop, FBS MT5 LIVE connector automatically reconnected to OCI successfully. OCI authenticated registry evidence: account row `5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51`, account `110664480`, server `FBS-Real`, broker `FBS Markets Inc.`, new `connectedAt=1789811064417`.
- Azure app is stopped, not deleted; it remains the rollback resource. DNS now points production to OCI.
- No cTrader or MT5 application code was changed for the migration; the same Git-backed Docker Compose stack and preserved `CBOT_TOKEN_SIGNING_KEY` / `CBOT_CONTROL_SECRET` were used.
- Final runtime-control snapshot remains owner-enabled globally: `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=true`.
- Final account-control snapshot: cTrader DEMO execution on/live off; cTrader LIVE execution off/live off; MT5 DEMO execution on/live off; FBS MT5 LIVE execution on/live on. Migration automation did not toggle these trading controls.
- Important safety note: FBS MT5 LIVE is currently capable of real-money broker execution because both global and per-account live gates are enabled. Infrastructure cutover did not place any order.
- Temporary migration branches/workflows were used for guarded inventory/cutover probes only; main production code remained unchanged apart from cumulative handoff documentation.

#### Rollback procedure + live-test state check — 2026-09-19

- Azure rollback sequence: (1) start old Azure Coolify app `edgvi4wezjodvwqa1dpkzbt7`; (2) verify direct Azure origin health/TLS on `20.57.161.98:25345`; (3) change Cloudflare `cbot.mkety.com` A record from OCI `89.168.70.209` back to Azure `20.57.161.98`, preserving DNS-only and TTL 300; (4) force long-lived connector sessions to reconnect by stopping OCI gateway or restarting connector process; (5) verify authenticated cTrader/MT5 session registry on Azure; (6) keep OCI available until acceptance is complete.
- Current global runtime gates are intentionally enabled by owner: `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=true`.
- FBS MT5 LIVE account `110664480` (`5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51`) is active with `execution_enabled=true`, `live_execution_enabled=true`; connector had successfully reconnected to OCI after Azure stop.
- Fresh event `telegram:-1003902892609:379` at 2026-09-19 10:07 UTC parsed as fast-entry `BUY BTCUSD`. It did not route to FBS LIVE.
- That event executed only on cTrader DEMO account `48685071`: one OPEN BTCUSD BUY leg, requested/executed 0.2 lots, fill 81280.58, broker position 138520138.
- MT5 DEMO account `213921698` route failed with `MT5_CONNECTOR_OFFLINE`, requested 0.1 lots.
- Source feed `-1003902892609` currently has routes only to cTrader DEMO destination `40eacf2a-...`, MT5 DEMO destination `87eb40ab-...`, and Telegram. There is no `trading_destinations` row targeting the FBS LIVE account row.
- Therefore turning LIVE gates on alone does not send this source to FBS LIVE. A dedicated FBS LIVE broker destination + source route (with explicit 0.01 sizing) is still required before a real-money test can occur from this source.
- No real-money order was placed by the migration or this verification.

#### FBS LIVE execution diagnosis — 2026-09-19

- FBS LIVE account `110664480` is a real connected MT5 account on `FBS-Real`, broker `FBS Markets Inc.`, execution/live gates ON, fixed sizing 0.01, fast-entry execute-immediately, market-only entry zone.
- Current OCI authenticated session check passed for FBS LIVE with fresh heartbeat; MT5 transport is online. MT5 DEMO is also online. cTrader sessions were offline at the latest check.
- Source feed `-1003902892609` now has active destination `mt5 live fbs` (`a075f689-7003-4376-b837-02c50021aba4`) and active route `mt5 route fbs` (`cde8ae14-3e59-4543-9166-645bc8759726`) to FBS LIVE.
- Events 381/382 included the FBS destination in the destination-routing outcomes, but no FBS `position_groups` or broker `destination_deliveries` rows were created. Therefore broker dispatch was never attempted for FBS.
- FBS generic/current docs confirm Cent accounts remain supported but can only be opened via an IB referral link; Cent order volume supports 0.01 step. This account predates/currently exists and is valid.
- The exact connected FBS account symbol catalog contains `BTCUSD` as `tradable=true`, platform symbol `BTCUSD`, min lots 0.01, step lots 0.01, max lots 500, contract size 1. Therefore BTCUSD symbol support and 0.01 minimum volume are not the blocker.
- Root cause identified in `cloudflare-v2/src/pipeline/v1_simulation_deps.js`: `instrumentProvider()` only synthesizes minimal fixed-lot instrument metadata from `trade_accounts.lot_value` when `environment === 'demo'`. For LIVE accounts, after resolving the authoritative broker symbol catalog, it requires a symbol entry in `TRADING_V1_SIMULATION_INSTRUMENTS`; otherwise it throws `simulation instrument metadata is not configured for <symbol>`.
- `cloudflare-v2/src/pipeline/v1_orchestrator.js` catches that error and marks the account `BLOCKED` with reason `MARKET_CONTEXT_UNAVAILABLE`, so no READY account plan, position group, or broker dispatch is produced. This exactly matches FBS being routed but not executed.
- Production `cloudflare-v2/wrangler.toml` contains no `TRADING_V1_SIMULATION_INSTRUMENTS`, `TRADING_V1_SIMULATION_PRICES`, or `TRADING_V1_SIMULATION_EXPOSURES` vars, and the production deploy workflow does not populate them. Demo accounts still execute because of the demo-only fixed-lot fallback; LIVE FBS does not.
- Recommended fix: make simulation/planning capability-driven for all fixed-lot broker accounts by deriving min/max/step from the already-authoritative destination symbol catalog + account lot_value, not by requiring a separate simulation-instrument env map for LIVE accounts. Preserve live execution gates and catalog validation; add RED tests proving LIVE fixed-lot MT5 BTCUSD with authoritative catalog becomes READY at 0.01 and unsupported symbols remain blocked.

#### LIVE broker planning parity hardening — 2026-09-19

- Audited LIVE-vs-DEMO execution differences after FBS LIVE route failed to produce a broker dispatch despite correct routing.
- Confirmed FBS LIVE account `110664480` on `FBS-Real` is online on OCI with fresh heartbeat, fixed lot `0.01`, execution/live gates enabled, and authoritative catalog support for `BTCUSD` (tradable, min/step `0.01`, max `500`, contract size `1`).
- Root planning defect: `v1_simulation_deps.instrumentProvider()` only synthesized fixed-lot instrument constraints when `environment === 'demo'`. LIVE fixed-lot accounts therefore required unrelated `TRADING_V1_SIMULATION_INSTRUMENTS` metadata and were blocked as `MARKET_CONTEXT_UNAVAILABLE` before any broker delivery was created.
- Fix: all fixed-lot accounts now derive planning constraints from the already-authoritative destination symbol catalog after successful symbol resolution. Broker min/max/step and available tick/contract metadata are preserved; if volume metadata is absent, the configured fixed lot is used as the safe exact bound. Unsupported/ambiguous/missing-catalog symbols remain fail-closed.
- Identified redundant cTrader LIVE blocker in `production_execution_deps.js`: after the normal persisted global/account LIVE authority already passed in the coordinator, the adapter additionally required legacy env `CTRADER_LIVE_TRADING_ENABLED`. Removed this duplicate adapter gate; cTrader runtime still receives `allowLiveTrading=true` only for persisted `environment=live`, while normal global/account LIVE authority remains enforced before dispatch.
- Identified LIVE retry authority inconsistency: `destination_retry_production.js` retried through `executeProductionPlan()` without supplying persisted LIVE runtime-control state. Fix now reloads `live_broker_execution_enabled` for each claimed retry and passes both `liveBrokerExecutionEnabled` and `liveBrokerExecutionControlAvailable` into the coordinator. LIVE retries therefore run only when the current global LIVE master and current account LIVE authority allow them; unavailable/off controls fail closed.
- MT5 connector has no separate hidden LIVE env switch. Legitimate checks retained: exact persisted workspace/account, active/execution flags, global LIVE master, per-account LIVE flag, kill switch/policy, connector online, exact account number/server/environment, authoritative symbol catalog resolution, lot normalization, idempotency and broker response.
- TDD RED proof: targeted run `35438932503` reached tests and failed on the three intended regressions (LIVE fixed-lot planning, redundant cTrader LIVE env gate, retry LIVE-control propagation).
- GREEN proof: targeted run `35438998373` passed all targeted tests after implementation; full Worker `npm test` run `35439048885` passed.
- No real broker order was placed by this engineering fix. Existing owner LIVE controls were not toggled.


#### LIVE broker parity production release — 2026-09-19

- PR #117 `Fix LIVE broker planning parity and retry authority` merged to main as `0cfa3632a4bb3fdd1d0aefa58315b3928a6272a1`.
- Standard PR checks passed: Worker, gateway, cBot build, deployment stack, normal tests and CodeQL.
- Main Trading V1 CI #3032 (`35439275003`) passed Worker/trading-core, MT5 bridge and MTProto Python tests.
- Production Cloudflare Deploy #103 (`35439275020`) completed successfully, including production health and persisted-owner-switch verification.
- Fresh post-deploy runtime controls remain owner-enabled exactly as intended: `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=true`.
- Fresh FBS LIVE state remains: account `110664480`, server `FBS-Real`, fixed 0.01 lots, active, execution ON, LIVE execution ON, persisted connector status connected.
- FBS destination/route remains active: `mt5 live fbs` / `mt5 route fbs` from source feed `-1003902892609`.
- Fresh authenticated OCI gateway session verification after deploy: FBS LIVE online with fresh heartbeat; MT5 DEMO online with fresh heartbeat; cTrader DEMO/LIVE sessions offline.
- The release itself placed no real-money order. Real FBS 0.01 end-to-end acceptance still requires a new user-originated source signal after Deploy #103 and immediate audit of FBS destination delivery, position group/leg and broker ticket/fill.


#### First confirmed FBS LIVE post-fix acceptance — 2026-09-19

- Production Cloudflare Deploy #103 on merge `0cfa3632a4bb3fdd1d0aefa58315b3928a6272a1` was live before this acceptance.
- Fresh source event `telegram:-1003902892609:383` (`buy btcusd again`) was accepted after the deploy and routed to both MT5 DEMO and FBS MT5 LIVE.
- FBS LIVE account row `5fd04cbf-fb82-4ca3-a9e1-cda6adbe4f51` executed BTCUSD BUY successfully at fixed 0.01 lots.
- FBS LIVE open delivery: status `SUCCEEDED`, requested lots `0.01`, broker retcode `10009` (`Request executed`), deal `5481774895`, order/position `5505241221`, fill `81231.05`, `recovered=false`, `duplicate=false`.
- Persisted FBS LIVE position group/leg recorded requested `0.01`, executed `0.01`, broker order/position `5505241221`, no failure code.
- Follow-up source event `telegram:-1003902892609:384` (`close`) correlated by source-message continuity and successfully closed the same FBS LIVE BTCUSD position.
- FBS LIVE close delivery: status `SUCCEEDED`, requested lots `0.01`, broker retcode `10009`, deal `5481774908`, order/position `5505241234`, close fill `81211.6`, `recovered=false`, `duplicate=false`.
- The corresponding FBS LIVE position group and leg are now `CLOSED`.
- All FBS LIVE open/close destination deliveries completed on attempt 1 with `failure_class=null`, `error_code=null`, `next_attempt_at=null`; no retry or uncertain row remained.
- The same open/close flow also succeeded on MT5 DEMO, demonstrating LIVE now follows the same broker execution path while retaining separate LIVE authority gates.
- This is the first confirmed real-money FBS LIVE end-to-end acceptance after the LIVE planner/retry parity fix. No assistant-generated trade was placed; the source events were user-originated.

#### Private-repository readiness work — 2026-09-19

- Goal: make `MketyDigital/Trading` permanently private without changing production trading behavior.
- Repository scan found no runtime dependency on `raw.githubusercontent.com/MketyDigital/Trading`, anonymous `git clone` of this repo, or public GitHub Release download URLs.
- GitHub Actions are same-repository `actions/checkout` / repository-token based and are compatible with private visibility.
- OCI Coolify private source inventory found two GitHub sources: public source id `0` and authenticated `mkety-github` source id `1`, UUID `chvanp2mn8p5msyzifqwywac`, installed for organization `MketyDigital`.
- Current production gateway app `p9xqtqpbljnggchy36mzd7a0` is still bound to Coolify public source id `0`.
- Current installed Coolify version rejected in-place application PATCH of `github_app_uuid` with HTTP 422 (`This field is not allowed.`), so source conversion cannot be done safely in place through this API version.
- A new authenticated private-source gateway app was successfully created via Coolify private-GitHub-App API: `wp23orxgfa9py7giponnvcjt`, name `Cbot Tcp gateway private`, source id `1`, repo `MketyDigital/Trading`, branch `main`, Docker Compose `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`.
- The new private-source app is staged only and is not production. The existing production gateway remains unchanged/running.
- Remaining one-time requirement before visibility change: copy the seven production gateway environment values from `p9xqtqpbljnggchy36mzd7a0` to `wp23orxgfa9py7giponnvcjt`, verify exact parity, then perform a controlled stop-old/start-new source cutover and validate health/WebSockets/authenticated sessions.
- Required keys: `ACME_EMAIL`, `CBOT_COMMAND_TIMEOUT_MS`, `CBOT_CONTROL_SECRET`, `CBOT_PUBLIC_HOST`, `CBOT_TOKEN_SIGNING_KEY`, `CLOUDFLARE_DNS_API_TOKEN`, `MT5_CONNECTOR_COMMAND_TIMEOUT_MS`.
- Added `docs/PRIVATE_REPOSITORY_OPERATIONS.md` with the private-source cutover, rollback, visibility-change acceptance, GitHub Free caveat, and future self-hosted-runner plan.
- Important GitHub Free organization caveat verified from current GitHub docs: branch protection/rulesets are available for public repos on Free, but private-repo protection requires Pro/Team/Enterprise. Private visibility therefore improves confidentiality but removes GitHub-enforced branch protection on the current Free org plan.
- Temporary private-readiness workflow was removed after collecting evidence; no probe workflow is intended to remain on main.

#### Private Coolify source compatibility probe — 2026-09-19

- Tested Coolify native application clone on current OCI production gateway `p9xqtqpbljnggchy36mzd7a0` to avoid secret plaintext handling.
- Clone UUID `lne867rvcoe635pdul2nhnzw` was created successfully and inherited the exact production environment key set: `ACME_EMAIL`, `CBOT_COMMAND_TIMEOUT_MS`, `CBOT_CONTROL_SECRET`, `CBOT_PUBLIC_HOST`, `CBOT_TOKEN_SIGNING_KEY`, `CLOUDFLARE_DNS_API_TOKEN`, `MT5_CONNECTOR_COMMAND_TIMEOUT_MS`.
- The cloned app remained on Coolify public source id `0`.
- Current installed Coolify API rejects both source-conversion mutations: `github_app_uuid` and `source_id` return HTTP 422 with `This field is not allowed.`. Therefore cloning cannot be combined with API source conversion on this version.
- Temporary secret-bearing clone `lne867rvcoe635pdul2nhnzw` was deleted successfully after the probe; volumes/docker/network cleanup were deliberately disabled because it was never deployed.
- The only staged replacement retained is authenticated private-source app `wp23orxgfa9py7giponnvcjt` using Coolify GitHub App source id `1` (`mkety-github`). It is not production and still needs the seven production env values before cutover.
- Production gateway remains `p9xqtqpbljnggchy36mzd7a0`; no DNS, trading controls, broker routes, connector settings, or runtime code were changed by this probe.
- Repository-admin visibility mutation is not exposed by the connected GitHub toolset, so the final GitHub public->private visibility toggle cannot be performed programmatically through the current connector.
- Credential-safety tooling also blocks assistant-mediated plaintext transfer of the seven gateway secret values between Coolify applications. This is the remaining infrastructure limitation before permanent private cutover.