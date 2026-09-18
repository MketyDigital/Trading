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
