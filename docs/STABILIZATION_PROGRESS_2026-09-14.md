# DEMO Stabilization Progress — 2026-09-14

## Priority
This remains the highest-priority work until real DEMO acceptance proves Telegram/source -> interpretation/AI fallback -> Telegram destinations + MT5 + cTrader -> durable state -> follow-up/management/reconnect behavior. LIVE must remain disabled.

## Current production revision
- PR #85 `Harden real DEMO management parsing and broker diagnostics` was squash-merged.
- Current stabilization merge commit on `main`: `652c5990529257af5dfbc6c00a87f014225b03c4`.
- Canonical operational source of truth: root `AGENTS.md`.
- Connector operator/acceptance guide: `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md`.
- Canonical design: `docs/superpowers/specs/2026-09-14-demo-execution-complete-stabilization-design.md`.
- Canonical plan: `docs/superpowers/plans/2026-09-14-demo-execution-complete-stabilization.md`.

## Automated status proven
Pre-merge exact stabilization code:
- Trading V1 CI run `34881442565`: Worker/Node PASS, MT5 bridge PASS, MTProto PASS.
- MT5 Compatibility CI run `34881442554`: PASS. This permanently exercises all `test_mt5_bridge*.py` suites.
- Windows MT5 Connector Release run `34881442599`: PASS; connector tests, build, smoke test, checksum and artifact upload all succeeded.

Post-merge production/release evidence:
- Production Cloudflare Deploy run `34883220839`: PASS, including production health probe, persisted broker-switch verification, safety posture recording and cleanup.
- Fresh `main` MT5 Connector Release run `34883220728`: PASS, including connector tests, Windows build, packaged-runtime smoke test, SHA256 generation, artifact upload and stable release publication.
- Fresh connector workflow artifact: `MketyMT5Connector-windows`, artifact id `10363831050`.
- Workflow artifact digest: `sha256:107711e1eaa480ad80acdc98d11c53072303145418b46738be040abe6bd1fb0d`.
- `MketyMT5Connector.exe` SHA256: `bda7175831608959e2dfd3a1647d8066abe3adcd4451d038624a998273a5d01e`.
- Temporary diagnostic workflow used during stabilization was removed before merge.

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

## Production safety immediately before and after merge deployment
Supabase project `vdblajgxrfndjesoyayy` was rechecked before merge:
- global `live_broker_execution_enabled = false`;
- global `broker_execution_enabled = true`;
- global `trading_access_enabled = true`;
- cTrader DEMO `40eacf2a-5a8a-4648-9b90-55038748d2ed`: active, execution enabled, live execution false;
- MT5 DEMO `87eb40ab-5cce-48c5-b764-149fd6b31ca5`: active, execution enabled, live execution false;
- cTrader LIVE `4dbe17df-40b0-412a-88de-9bbc562969c7`: active but execution disabled and live execution false.

The post-merge Production Cloudflare Deploy safety-posture step passed. LIVE was not enabled.

## Current routed DEMO source state
Production source UUID `48860770-4b2c-4b13-b49f-7d998f9d7ed5` remains active, provider `external_mtproto`, with allowlist mode enabled.

Its two active priority-100 routes currently point only to:
- cTrader DEMO destination `3d6bb915-6076-4760-b9b6-f874cedd4b4e` -> trade account `40eacf2a-5a8a-4648-9b90-55038748d2ed`;
- MT5 DEMO destination `318bb85e-ed8c-448d-92e5-9ba13484875a` -> trade account `87eb40ab-5cce-48c5-b764-149fd6b31ca5`.

Both broker destinations are currently marked HEALTHY. The source connection itself is an external adapter and its DB health heartbeat fields are not authoritative (`health_status=DISABLED`, null connection timestamps); confirm source transport by actual event arrival rather than that health field.

## Critical MT5 acceptance finding
The most recent MT5 delivery evidence before installing the fresh connector still came from the older Windows connector and failed with:

`order_check failed: retcode=None last_error=-2 Invalid "comment" argument`

This is the exact old compatibility failure fixed by the new connector/bridge code. Therefore **do not count MT5 as accepted until the freshly built `main` connector is installed/restarted** and a new post-install event succeeds.

The MT5 DEMO account currently persisted is `213921698` on `Deriv-Demo`; its observed XAUUSD capabilities include 3 digits, tick size `0.001`, minimum lot `0.01`, maximum lot `10.0`, step `0.01`, market execution and filling-mode metadata. Revalidate identity after the fresh connector connects.

## Real DEMO evidence before the fresh connector install
Recent cTrader DEMO execution is working and has returned real broker IDs. Examples from the acceptance source include XAUUSD position `136544600`, order `43975733`, deal `40571899`, executed 0.01 lot at 4311.44. These prove cTrader routing/execution but do not replace the required post-merge end-to-end acceptance sequence.

MT5 recent deliveries before replacement of the Windows binary remain terminal failures from the old comment behavior; do not replay their failed idempotency keys as a substitute for a fresh source event.

## Remaining acceptance — do not call complete until fresh evidence exists
- [x] Production deploy of merged #85 succeeds with LIVE still off.
- [x] Fresh Windows MT5 connector build from merged `main` succeeds and is checksum-published.
- [ ] Fresh Windows MT5 connector build is installed/restarted and reports connected to DEMO account `213921698` / expected DEMO server.
- [ ] Fresh Telegram XAUUSD entry reaches configured Telegram destination(s), cTrader DEMO and MT5 DEMO independently.
- [ ] cTrader and MT5 both return real broker IDs and Supabase contains matching durable group/leg bindings.
- [ ] Exact source-event replay produces no duplicate broker open.
- [ ] AI-required source wording succeeds when AI works.
- [ ] Materially recoverable signal executes through deterministic fallback when AI is unavailable/fails.
- [ ] Non-material numeric/value differences only warn and never veto the coherent trade.
- [ ] Explicit reply/follow-up BE, SL move, TP change, partial close, full close and pending cancel (where applicable) execute correctly on both brokers and persist lifecycle updates.
- [ ] Configured Telegram follow-up/update destinations receive the correct correlated output using the user's selected template/AI mode.
- [ ] Fast signal followed by completion/update reuses the same logical trade/group and does not duplicate broker positions.
- [ ] Connector restart/reconnect/replay does not duplicate open or management actions.
- [ ] Recovery from durable state preserves correlation.
- [ ] Zero LIVE executions throughout acceptance.

## Immediate next action
1. Install/run the exact fresh `MketyMT5Connector.exe` from post-merge run `34883220728`.
2. Keep MetaTrader 5 open and logged into the intended DEMO account.
3. Pair with a fresh one-time token if required; do not expose that token in chat or logs.
4. Confirm connector output shows the expected DEMO account/server.
5. Only then send one new controlled XAUUSD signal from an allowlisted Telegram source.
6. Query the new trading event, both destination deliveries, position groups/legs and broker IDs before sending any management action.
7. Continue replay -> BE -> explicit SL -> TP -> partial close -> full close -> pending cancel -> fast-signal -> reconnect/recovery.
8. Re-query LIVE guards at the end.

## Rule for the next agent/session
Start with root `AGENTS.md`, then this file. Do not redesign or replace the normalized lifecycle. Diagnose each real DEMO failure from production event/delivery/state evidence, add a regression test for the exact root cause, patch minimally, rerun CI/release/deploy, and retest. LIVE remains OFF.