# CMP / Telegram / AI / Operations Stabilization Handoff — 2026-09-16

Read root `AGENTS.md`, then the design and plan for this workstream:

- `docs/superpowers/specs/2026-09-16-cmp-telegram-ai-observability-stabilization-design.md`
- `docs/superpowers/plans/2026-09-16-cmp-telegram-ai-observability-stabilization.md`

Branch: `fix/cmp-telegram-ai-observability-stabilization`
Draft PR: `#100`

## Safety

No LIVE control was enabled or intentionally modified in this workstream. Continue requiring global/workspace/account LIVE execution OFF through DEMO stabilization.

## Real production evidence captured before implementation

### CMP event

Starpips event:

- external event: `telegram:-1003902892609:312`
- source text: `BUY XAUUSD (CMP)` plus source footer
- source connection: `48860770-4b2c-4b13-b49f-7d998f9d7ed5`
- feed native chat: `-1003902892609`
- persisted processing status: `NEEDS_REVIEW`
- error: `All AI providers failed in cascade.`

The feed has active routes to MT5, cTrader and Telegram. Broker execution did not happen because the deterministic parser did not understand CMP and the AI cascade failed.

### Telegram route/destination

Feed `-1003902892609` has an active Telegram route to destination `4c3ffacb-5fe5-442a-907a-5ac8e1e8bcae` (`telegram real vip2`, chat `-1003928022251`).

The destination itself currently reports:

- active: true
- health: `DEGRADED`
- last error: `TELEGRAM_SEND_REJECTED`
- legacy encrypted credential present
- no reusable credential connection currently attached

This proves routing selected Telegram and the Bot API rejected the send. Existing production code discarded Telegram's response description on non-2xx and did not journal the failure per trading event, so the exact Bot API reason is not recoverable for the already-failed message.

### Later GOLD test

Event `telegram:-1004387586337:884` parsed READY and reached broker execution. Valid legs succeeded on both cTrader and MT5. The first SELL leg with TP `4380` failed because that TP was above current ASK/current SELL geometry; cTrader reported `TRADING_BAD_STOPS` and MT5 reported invalid stops. This is correct fail-closed broker behavior for invalid signal geometry, not a platform outage.

Feed `-1004387586337` currently has MT5 and cTrader routes but no Telegram route, so it is intentionally skipped for Telegram under strict selective routing.

## Immediate implementation completed on branch

### CMP aliases

Added `src/normalization/current_market_aliases.js` and integrated it before deterministic machine planning in `trading_interpreter.js`.

Recognized aliases include:

- CMP
- C.M.P
- CURRENT MARKET PRICE
- CURRENT MKT PRICE
- CURRENT PRICE
- MARKET PRICE
- AT MARKET
- CURRENT MARKET
- MKT PRICE

Concise side+symbol commands normalize to the existing `NOW` deterministic MARKET path. Existing blocker words still fail closed. Regression coverage: `tests/cmp_market_aliases.test.mjs`.

### Telegram rejection diagnostics + event journal

`telegram_destination.js` now parses non-2xx Telegram JSON and returns sanitized provider diagnostics:

- providerCode
- providerDescription (bounded/sanitized)
- retryAfter when supplied

No token is included.

`v1_destination_delivery_acceptance.js` now writes Telegram success/failure to `destination_deliveries` using the existing event/destination idempotency key. Failure rows include normalized error code, failure class, HTTP/provider diagnostics and destination metadata. Journal persistence failure never converts an already-accepted Telegram send into a retryable send, avoiding duplicates.

Regression coverage: `tests/telegram_delivery_diagnostics.test.mjs`.

## AI provider audit findings

Production Starpips currently has exactly one active `ai_providers` row:

- provider: `openai`
- model: `gpt-5.6-luna`
- encrypted key present: yes
- plaintext key present: no
- uses binding: false
- base URL: null/default

The model ID is currently valid for the OpenAI Responses API.

Current backend limitations:

1. Admin allowlist currently supports `openai`, `gemini`, `google`, `deepseek`, `groq`, `cloudflare_ai`, `workers_ai`, `custom`.
2. `azure_openai`, `vertex_ai`, `aws_bedrock` are not first-class admin provider types.
3. Universal router directly handles Gemini/Google, Cloudflare/Workers AI and OpenAI Responses; every other provider falls through to generic OpenAI-compatible chat completions.
4. Azure OpenAI therefore lacks its proper endpoint/deployment/API-version/auth contract.
5. Vertex AI is not implemented as Vertex; treating `google` as Gemini is insufficient.
6. AWS Bedrock is not implemented.
7. Cloudflare AI currently falls back to `env.CLOUDFLARE_ACCOUNT_ID` if the DB row lacks account ID; approved target is DB-authoritative provider configuration with no provider-specific env fallback.
8. `UniversalAIRouter.processSignal()` catches provider exceptions and only returns generic `All AI providers failed in cascade.`. It does not persist provider HTTP/auth/quota/model/timeout details, so the root cause of the current OpenAI failure cannot be recovered from existing records.

Do not guess that the encrypted OpenAI key itself is bad. The DB proves only that encrypted material exists; current observability cannot distinguish invalid key, access/model permission, HTTP error, quota, timeout or malformed response.

## Next-session implementation scope

Continue Tasks 3–7 from the plan:

1. first-class DB-authoritative OpenAI, Azure OpenAI, Gemini, Vertex AI, Cloudflare AI and AWS Bedrock adapters;
2. provider health/test action with sanitized persisted diagnostics;
3. no new plaintext provider credentials and no provider-specific config env fallback;
4. normalized durable operation journal spanning ingress, parser/AI, feed/route selection/skip, Telegram, broker planning/execution, management, replay/reconciliation and connector state;
5. customer Operations serializer/UI: workspace-only, actionable, infrastructure-neutral;
6. Mkety Admin site-wide diagnostics: full internal component/provider context but never plaintext secrets;
7. full non-regression matrix, docs, exact-head CI, zero-LIVE audit and controlled DEMO re-test.

## Customer vs Mkety Admin visibility rule

Customer Operations may show only customer-facing concepts: their source/feed/route, Telegram, MT5, cTrader, broker account, MT5 terminal/VPS connector, AI provider/model, signal/trade/management/destination and useful reason/status.

Customer Operations must not expose internal hosting/infrastructure names such as Cloudflare Workers, OCI, Coolify, internal queues/services/database URLs, stack traces or other tenants.

Mkety Admin may expose internal provider/component/HTTP/circuit/retry/correlation/resource IDs needed for support, but still never plaintext credentials.

## Verification state at handoff creation

PR #100 CI was started on immediate fixes. Do not merge/deploy until the exact latest branch head is green and the usual fresh zero-LIVE safety audit is repeated.
