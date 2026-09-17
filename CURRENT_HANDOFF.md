# Current Development Handoff

Read root `AGENTS.md` first. This top section is the newest continuation authority. Older handoff content is preserved in repository history and dated handoff/spec/plan documents.

## PR #101 release-candidate authority — 2026-09-17

### Production main before merge

Production `main` remains:

- `98bb917d562a40e212a51bd6eba726ff2d212fbc`
- merged PR `#100` — `Stabilize CMP and Telegram diagnostics`

PR #101 is not production authority until it is merged and deployed.

### Active continuation

- branch: `fix/ai-operations-observability-continuation`
- PR: `#101` — `Stabilize deterministic revisions, protection policy, and Telegram lineage`
- exact final verified branch head: `96d3e3c68a73733336c2a090bafc5b2460dcfb74`
- exact implementation/security head inside that history: `537934877e7a24cf22c422aea3cff228774f4460`
- Trading V1 CI `#2944` — success on the final branch head across Worker/trading-core, MT5 bridge and MTProto
- Trading V1 CI `#2943` — success on the exact security-fix implementation head
- GitHub CodeQL on the implementation head — success, with no new alerts in code changed by PR #101
- LIVE has not been enabled by this continuation.

### Verified continuation behavior

The continuation branch verifies, additively and without replacing the existing trading engine:

- structurally explicit incomplete signals do not require AI merely because optional SL/TP is missing;
- prose/conditional/contradictory ambiguity remains guarded/fail-closed;
- invalid protection uses canonical field-level validation with strict `reject_trade` as backward-compatible default and explicit opt-in `skip_invalid` for allowed optional SL/TP fields;
- valid sibling protection may proceed while skipped invalid fields remain explicit Operations evidence; risk-based sizing still blocks when a valid SL is required for risk math;
- Telegram edits are append-only revisions of one logical source message/trade, not new opens;
- exact revision replay is no-resend/idempotent; changed revisions receive distinct broker idempotency keys;
- edited SL/TP can become `MODIFY_POSITION` management against the same durable group; edit handling cannot create a new `OPEN_POSITION`;
- formatting-only edits produce no broker action; omission is not destructive removal; explicit removal wording is required;
- replies remain strongest correlation and guarded no-reply unique-context management remains intact;
- Telegram destination replies/edits preserve destination lineage across `none`, `clean`, `template`, and `ai_then_fallback`; missing edit mapping never falls back to duplicate standalone send;
- missing broker fill remains absent rather than becoming `0`; full close preserves opening broker identity/fill while recording zero remaining volume and close time;
- first-class DB-authoritative AI adapters cover OpenAI, Azure OpenAI, Gemini, Vertex AI, Cloudflare AI and AWS Bedrock plus explicitly configured compatible providers;
- new AI credentials are encrypted, public provider config is whitelisted, and provider-specific account/project/region authority comes from the persisted row rather than environment fallback;
- AI attempts carry normalized sanitized diagnostics through interpretation/fallback; provider health testing persists only sanitized latest-health evidence;
- `operation_journal` is one canonical append-only/idempotent, workspace-scoped, secret-safe evidence stream and never becomes retry/resend authority;
- lifecycle evidence includes interpretation/AI attempts, correlation, protection skips, source-edit/management outcomes, destination send/reply/edit results and broker outcomes;
- journal failure is best-effort/non-authoritative and cannot change accepted trading/destination results or cause another send;
- customer Operations exposes a workspace-scoped timeline and per-event audit with read-time redaction;
- Launch Console Risk & Audit renders recent lifecycle evidence without exposing raw internal details;
- Mkety staff has a separate secret-gated, read-only site-wide Operations diagnostics API/page with richer sanitized context and no trading/retry authority;
- migration `0042_operation_journal.sql` is the single canonical journal migration;
- journal summaries/details are secret-redacted on write and again on customer read;
- migration `0039_trading_event_revisions.sql` enables RLS, revokes anon/authenticated table privileges and explicitly grants service-role runtime persistence.

### Fresh pre-merge production safety preflight

Read-only production checks on 2026-09-17 found:

- `trading_access_enabled=true`;
- `broker_execution_enabled=true`;
- `live_broker_execution_enabled=false`;
- cTrader DEMO `48685071` active/execution-enabled with `live_execution_enabled=false`;
- MT5 DEMO `213921698` active/execution-enabled with `live_execution_enabled=false`;
- cTrader LIVE `48681337` remains `execution_enabled=false` and `live_execution_enabled=false`;
- cTrader, MT5 and Telegram destinations are active and report `HEALTHY`;
- external MTProto source is active but persisted `health_status=DISABLED`, so source readiness must be restored/verified before using it as real acceptance transport;
- four active Telegram source feeds are materialized and routes are feed-scoped;
- migrations 0039–0042 are not partially applied in production yet; `trading_event_revisions` and `operation_journal` were absent at preflight.

### Remaining release gates before any LIVE test

1. merge PR #101 to `main`;
2. apply migrations 0039–0042 through the reviewed production migration path and verify grants/RLS/schema;
3. deploy merged `main` through `.github/workflows/production-cloudflare-deploy.yml`;
4. immediately re-query runtime controls, accounts, source/feed/route/destination state and connector/gateway health;
5. restore/verify a healthy intended Telegram source path without weakening authorization;
6. run the controlled real DEMO matrix for source/feed isolation, exact/template/AI-fallback Telegram delivery, replies, edits, unique-context management, protection skips, cTrader, MT5, replay/idempotency, fast->full completion, partial/full close, pending/cancel, reconnect/recovery and Operations evidence;
7. perform a fresh final zero-LIVE audit.

Passing CI or deployment alone does not authorize LIVE. The user has requested progression toward LIVE after DEMO signoff, but the first LIVE test remains narrow, explicitly scoped and protected by persisted LIVE controls.