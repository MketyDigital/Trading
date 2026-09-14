# DEMO Stabilization Progress — 2026-09-14

## Priority
This remains the highest-priority work until real DEMO acceptance proves Telegram/source -> interpretation/AI fallback -> Telegram destinations + MT5 + cTrader -> durable state -> follow-up/management/reconnect behavior. LIVE must remain disabled.

## Current branch / PR
- PR: #85 `Harden real DEMO management parsing and broker diagnostics`
- Branch: `fix/demo-management-observability-20260914`
- Pre-handoff head before this documentation commit: `94e29690c514e4e1b06bd5f62dc58a742b5c17e4`
- Base main: `526eda999aceca78a78f4f0ad59d52cd9fca8d3c`
- Canonical design: `docs/superpowers/specs/2026-09-14-demo-execution-complete-stabilization-design.md`
- Canonical plan: `docs/superpowers/plans/2026-09-14-demo-execution-complete-stabilization.md`

## Automated status proven
- Trading V1 CI run `34881442565`: Worker/Node PASS, MT5 bridge PASS, MTProto PASS.
- MT5 Compatibility CI run `34881442554`: PASS. This permanently exercises all `test_mt5_bridge*.py` suites.
- Windows MT5 Connector Release run `34881442599`: PASS; connector tests, build, smoke test, checksum and artifact upload all succeeded.
- Temporary diagnostic workflow used to expose hidden CI assertions has been removed.

## Implemented / protected behavior
### Interpretation and validation
- Deterministic parsing remains first.
- AI remains available for genuine ambiguity.
- AI outage, provider failure, bad JSON, unsupported AI event type or hard-AI validation failure attempts deterministic material fallback before `NEEDS_REVIEW`.
- Secondary numeric/raw-price comparison is advisory and returns warnings; it does not veto a coherent trade.
- Hard contradictions still block: explicit opposite side, explicit do-not-trade instruction, wrong instrument, explicit pending-order conflict, and genuinely unsafe/impossible SL/TP geometry.

### Telegram destinations
- Existing deterministic and AI-enabled destination rendering remains intact.
- Existing template fields remain available: formatting mode, parse mode, brand name, header, footer, disclaimer, emoji style, cleanup rules and layout/field order.
- Destination AI retains deterministic fallback and canonical-echo protection.
- Destination failures remain isolated from sibling destinations/broker execution.

### Management / follow-ups
- `SL AT BE`, `SL AT BE NOW`, `SL TO BE NOW` normalize deterministically to `MOVE_SL_TO_BE`.
- `STOPPED AT BE AFTER TP2` is informational `NO_ACTION`, not a destructive management action.
- Existing reply/thread/symbol/recent-group correlation and fast-signal lifecycle code is preserved.

### cTrader
- Broker-facing `clientMsgId` is deterministically bounded to <=64 characters for opens and management while the full internal idempotency identity remains durable.
- cTrader rejection code + description are persisted in failure diagnostics.

### MT5
Capability behavior is driven by actual MT5 symbol/account capabilities, not broker names:
- restrictive short deterministic broker comment marker;
- commentless `order_check` fallback when a broker rejects comments;
- suffix/prefix/canonical symbol resolution from terminal catalog;
- min/max/volume-step normalization;
- tick-size/digits price normalization while preserving prices when optional metadata is absent;
- FOK/IOC/RETURN filling compatibility;
- market/pending support including STOP_LIMIT when terminal constants support it;
- exact broker/terminal preflight diagnostics;
- existing close/partial-close/SL/TP/cancel paths preserved;
- deterministic replay/reconciliation identity preserved.

## Real DEMO evidence before PR #85
- cTrader XAUUSD real DEMO open succeeded: position `136391850`, order `43957769`, deal `40555363`, fill `4265.15`, 0.01 lot.
- Supabase durable group/leg state was created successfully after migration 0033.
- MT5 reached the running connector but the machine was still running a stale connector that rejected the old comment format.
- A correlated cTrader `close` reached the correct group but returned `INVALID_REQUEST`; root cause was an overlong management `clientMsgId`, now fixed and regression-tested.

## Production safety immediately before real-DEMO deployment
Supabase project `vdblajgxrfndjesoyayy` was rechecked:
- global `live_broker_execution_enabled = false`;
- global `broker_execution_enabled = true`;
- global `trading_access_enabled = true`;
- cTrader DEMO `40eacf2a-5a8a-4648-9b90-55038748d2ed`: active, execution enabled, live execution false;
- MT5 DEMO `87eb40ab-5cce-48c5-b764-149fd6b31ca5`: active, execution enabled, live execution false;
- cTrader LIVE `4dbe17df-40b0-412a-88de-9bbc562969c7`: active but execution disabled and live execution false.

## Deployment constraint / controlled next step
The production Cloudflare deploy workflow explicitly refuses non-`main` refs (`Production deploy may run only from main`). Therefore real Telegram DEMO acceptance cannot exercise PR #85 production code without first putting the tested code on `main`. The controlled sequence is:
1. keep all LIVE controls off;
2. merge the exact green PR #85 head to `main` only as the DEMO deploy vehicle;
3. verify Production Cloudflare Deploy + secret/safety/readiness workflows green;
4. make sure the Windows machine is running the newly built MT5 connector from the accepted code;
5. send/observe fresh real Telegram DEMO entries and management updates;
6. do not enable LIVE unless every acceptance item below passes and a separate LIVE-readiness review is completed.

## Remaining acceptance — do not call complete until fresh evidence exists
- [ ] Production deploy of merged #85 succeeds with LIVE still off.
- [ ] Fresh Windows MT5 connector build is installed/restarted and reports connected to DEMO account `213921698`.
- [ ] Fresh Telegram XAUUSD entry reaches configured Telegram destination(s), cTrader DEMO and MT5 DEMO independently.
- [ ] cTrader and MT5 both return real broker IDs and Supabase contains matching durable group/leg bindings.
- [ ] AI-required source wording succeeds when AI works.
- [ ] Materially recoverable signal executes through deterministic fallback when AI is unavailable/fails.
- [ ] Non-material numeric/value differences only warn and never veto the coherent trade.
- [ ] Explicit reply/follow-up BE, SL move, TP change, partial close, full close and pending cancel (where applicable) execute correctly on both brokers and persist lifecycle updates.
- [ ] Configured Telegram follow-up/update destinations receive the correct correlated output using the user's selected template/AI mode.
- [ ] Fast signal followed by completion/update reuses the same logical trade/group and does not duplicate broker positions.
- [ ] Replay/reconnect/restart does not duplicate open or management actions.
- [ ] Recovery from durable state preserves correlation.
- [ ] Zero LIVE executions throughout acceptance.

## Rule for the next agent/session
Do not redesign or replace the normalized lifecycle. Continue from the acceptance checklist above. Diagnose each real DEMO failure from production event/delivery/state evidence, add a regression test for the exact root cause, patch minimally, rerun CI/release/deploy, and retest. LIVE remains OFF.