# Current Development Handoff

Read root `AGENTS.md` first. This top section is the newest continuation authority. Older handoff content is preserved afterward as historical evidence and must not override the current branch/main facts below.

## PR #101 release-candidate authority — 2026-09-17

### Production main

Production `main` remains:

- `98bb917d562a40e212a51bd6eba726ff2d212fbc`
- merged PR `#100` — `Stabilize CMP and Telegram diagnostics`

PR #101 is not production authority until it is merged to `main`, deployed through the normal production workflow, and accepted against the real DEMO matrix.

### Active continuation

- branch: `fix/ai-operations-observability-continuation`
- PR: `#101` — `Stabilize deterministic revisions, protection policy, and Telegram lineage`
- exact latest verified implementation head before this documentation commit: `537934877e7a24cf22c422aea3cff228774f4460`
- Trading V1 CI `#2943` — success across Worker/trading-core, MT5 bridge and MTProto
- GitHub CodeQL on the exact head — success, with no new alerts in code changed by PR #101
- LIVE has not been enabled by this continuation.

### Verified continuation behavior

The continuation branch now verifies, additively and without replacing the existing trading engine:

- structurally explicit incomplete signals do not require AI merely because optional SL/TP is missing;
- prose/conditional/contradictory ambiguity remains guarded/fail-closed;
- invalid protection is handled by canonical field-level validation policy, with strict `reject_trade` as the backward-compatible default and explicit opt-in `skip_invalid` for allowed optional SL/TP fields;
- valid sibling protection can proceed while skipped invalid fields remain explicit Operations evidence; risk-based sizing still blocks if the invalid/missing SL is required for risk math;
- Telegram edits are append-only revisions of one logical source message/trade, not new opens;
- exact revision replay is no-resend/idempotent; changed revisions receive distinct broker idempotency keys;
- edited SL/TP can become `MODIFY_POSITION` management against the same durable group, while semantic edit handling is structurally unable to create a new `OPEN_POSITION`;
- formatting-only edits produce no broker action; omission of SL/TP is not destructive removal; explicit removal wording is required;
- replies remain strongest correlation, and guarded no-reply unique-context management remains intact;
- Telegram destination replies and edits preserve mapped destination lineage across `none`, `clean`, `template`, and `ai_then_fallback`; missing edit mapping never falls back to duplicate standalone send;
- missing broker fill remains absent rather than becoming `0`; full close state preserves opening broker identity/fill while recording zero remaining volume and close time;
- first-class DB-authoritative AI adapters cover OpenAI, Azure OpenAI, Gemini, Vertex AI, Cloudflare AI and AWS Bedrock, plus explicitly configured compatible providers;
- AI provider configuration is DB-authoritative, new credentials are encrypted, public provider config is whitelisted, and Cloudflare provider account identity no longer falls back to environment-specific provider config;
- AI attempts carry normalized sanitized diagnostics through interpretation/fallback; provider health testing persists only sanitized latest-health evidence;
- the normalized `operation_journal` is one canonical append-only/idempotent, workspace-scoped, secret-safe evidence stream and never becomes resend/retry authority;
- lifecycle evidence includes interpretation/AI attempts, correlation, protection skips, source-edit/management outcomes, destination send/reply/edit results and broker outcomes;
- journal write failure is best-effort/non-authoritative and cannot change accepted trading/destination results or cause another send;
- customer Operations exposes a workspace-scoped, customer-safe timeline and per-event lifecycle audit using read-time redaction;
- the existing Launch Console Risk & Audit surface now renders recent lifecycle evidence without exposing raw internal details;
- Mkety staff has a separate secret-gated, read-only site-wide Operations diagnostics API/page with richer sanitized filters/context and no trading/retry authority;
- duplicate competing operation-journal migration/module work was removed before merge; migration `0042_operation_journal.sql` is the single canonical journal migration;
- operation-journal summaries/details are secret-redacted on write and again on customer read;
- migration `0039_trading_event_revisions.sql` explicitly revokes anon/authenticated table privileges and grants service-role runtime persistence.

### Fresh pre-merge production safety preflight

Read-only production checks on 2026-09-17 found:

- `trading_access_enabled=true`;
- `broker_execution_enabled=true`;
- `live_broker_execution_enabled=false`;
- cTrader DEMO account `48685071` active/execution-enabled with `live_execution_enabled=false`;
- MT5 DEMO account `213921698` active/execution-enabled with `live_execution_enabled=false`;
- cTrader LIVE account `48681337` remains `execution_enabled=false` and `live_execution_enabled=false`;
- cTrader, MT5 and Telegram destinations are active and currently report `HEALTHY`;
- the external MTProto source is active but its persisted `health_status` is `DISABLED`, so source readiness must be re-established/verified before relying on it for real acceptance;
- migrations 0039–0042 are not partially applied in production yet (`trading_event_revisions` and `operation_journal` were absent at preflight), which is the expected pre-deploy state.

### Remaining release gates before any LIVE test

1. merge reviewed PR #101 to `main`;
2. deploy only merged `main` through the normal production workflow and apply migrations 0039–0042 through the normal migration path;
3. immediately re-query runtime controls, accounts, workspace entitlements, sources/feeds/routes/destinations and connector/gateway health;
4. restore/verify a healthy intended Telegram source path without weakening source authorization;
5. run the controlled real DEMO matrix for source/feed isolation, exact/template/AI-fallback Telegram destination, replies, edits, unique-context management, protection skips, cTrader, MT5, replay/idempotency, fast->full completion, partial/full close, pending/cancel, reconnect/recovery and Operations evidence;
6. perform a fresh final zero-LIVE audit.

Passing CI or deployment alone does not authorize LIVE. After full DEMO signoff, the user has requested progression toward LIVE, but the first LIVE test must still be narrow, explicitly scoped, and guarded by the persisted LIVE controls.

---

## Historical handoff content — preserved in repository history and dated handoff documents.

The authoritative current continuation state is the section above plus root `AGENTS.md` and the dated design/plan documents under `docs/` and `docs/superpowers/`.