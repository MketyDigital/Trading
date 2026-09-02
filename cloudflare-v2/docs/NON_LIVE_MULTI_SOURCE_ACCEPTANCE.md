# Non-live Multi-source Acceptance and Operational Gate

This runbook closes implementation-plan Task 9 for `cloudflare-v2`. It is deliberately non-live. It does not authorize real broker execution, does not replace the broker demo acceptance gates, and does not relax the shared-Supabase or multi-tenant isolation rules in `AGENTS.md`.

## Preconditions

Before any environment run:

- inspect the real shared Supabase schema before applying checked-in Trading migrations `0003`-`0006`;
- keep unrelated Mkety tables unchanged;
- keep `trading_access_enabled=false` until the intended Zitadel organization/role mapping is configured and independently verified;
- keep real-money execution disabled;
- use test Telegram accounts/channels and non-live Trading sources only;
- never place secret values in Git, chat, command output, health responses, or acceptance summaries.

## Static/CI gate

The exact Task 9 acceptance suite must prove all of the following before environment testing:

1. Multiple source/provider families coexist without a global provider dependency.
2. A source/provider failure is scoped to that source/workspace and does not mutate sibling authorization, credentials, health, retry state, defaults, or canonical identity.
3. Container, Durable Object, and external MTProto replays converge on provider-independent Telegram native identity inside one workspace only.
4. Recovery/catch-up replay cannot create a second interpretation/orchestration path for the same persistent canonical event.
5. Destination fan-out is workspace scoped: one destination failure does not block or roll back successful siblings.
6. Retry can target only failed destinations; already successful siblings are not redispatched.
7. A foreign-workspace destination is rejected locally without preventing valid sibling destinations from running.
8. Duplicate destination identifiers are rejected independently instead of being dispatched twice.
9. Sanitized results contain fixed error codes/health fields only and never echo provider, source, Telegram-session, destination, broker, signing, or database credential values.
10. All four mandatory CI gates pass at the same exact branch head: Node Worker/trading-core, pure MT5 bridge, both MTProto Python suites, and Wrangler dry-run.

Task 9 TDD checkpoints:

- destination fan-out RED: run `33630032190` at `7c27ca546602b48fcbfa7b1db8051f6e4469af0f`; 378 tests passed and the only failure was missing `src/destinations/destination_fanout.js`;
- destination fan-out GREEN: run `33630219329` at `fa253f04eba80354781a91474a237ebd02c51f34`; all four mandatory gates passed;
- MTProto soak harness GREEN: run `33629585665` at `276abbc362c03703d897f1410f1eeb534ff75b07`.

## MTProto soak command

From `cloudflare-v2/`:

```text
npm run soak:mtproto:container
```

The soak harness is observation-only. It must not invoke a broker executor or a live-trading switch. Environment validation is explicit opt-in and reports missing configuration names only. Record per-source connectivity/health transitions, reconnect observations, event latency, catch-up observations, and duplicate/canonical-identity observations.

Do not interpret a static GREEN harness as proof that real Cloudflare Container session/update-state recovery is lossless. Cloudflare Container disk is ephemeral; real reconnect/restart/catch-up behavior must still be exercised with a test Telegram account/channel and durable downstream idempotency enabled.

## Controlled non-live environment matrix

Use at least two independent workspaces or source identities when practical so isolation is observed rather than assumed.

### Source/provider isolation

- Send a valid test event through source A while source B is healthy; both should operate independently.
- Inject a retryable failure into source A transport/downstream path; source B must continue without authorization, health, retry, or queue-state changes.
- Disable/revoke source A; source B must remain operational.
- Attempt a caller workspace/source override; trusted server-side source/workspace identity must remain authoritative.

### Reconnect/catch-up/replay

- Deliver one Telegram test message and confirm one persistent canonical event/orchestration.
- Restart/disconnect the selected MTProto runtime.
- Replay/catch up the exact native message and confirm terminal duplicate handling with no second orchestration/destination work.
- Deliver the next Telegram message id and confirm it proceeds once as a distinct canonical event.
- Where two Telegram providers observe the same native event, confirm they converge on `telegram:<accountScope>:<chatId>:<messageId>` only inside the same workspace.

### Destination fan-out isolation

Use non-broker/simulation destinations for this gate.

- Configure at least three same-workspace destinations.
- Make one destination fail and verify the other destinations complete independently.
- Retry only the failed destination and verify successful siblings are not redispatched.
- Include a foreign-workspace destination and verify it is rejected locally while valid siblings continue.
- Include a duplicate destination id and verify only the first instance is dispatched.
- Confirm returned/recorded failure information is sanitized and does not echo underlying exception text or credentials.

## Stop conditions

Stop the environment acceptance immediately if:

- any unrelated Mkety/shared table is altered;
- one workspace/source/provider/destination changes another integration's credentials, authorization, health, retries, defaults, idempotency, or execution behavior;
- a replay produces a second Position Group/orchestration/destination delivery for the same canonical event;
- a successful destination is rolled back or automatically redispatched because a sibling failed;
- secret values appear in logs, health, API responses, or summaries;
- any non-live acceptance path reaches a real broker executor.

## Gate outcome and next boundary

Task 9 is complete at the source-code/CI level. Environment acceptance still requires real account/runtime access and therefore must be performed only after the actual shared-Supabase migration state is inspected and the non-live staging identities are configured.

The next safe engineering boundary is controlled staging readiness: inspect/apply only the required Trading-owned migrations, configure non-live source/auth bindings, run signed V1 and MTProto soak acceptance, then run cTrader/MT5 demo probes/lifecycles behind their existing explicit demo gates. Real-money execution remains disabled until all non-live and demo acceptance is green and a separate deliberate live cutover decision is made.
