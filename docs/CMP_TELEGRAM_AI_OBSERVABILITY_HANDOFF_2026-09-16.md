# CMP / Telegram / AI / Operations Stabilization Handoff — 2026-09-16

Read root `AGENTS.md`, then the design and plan for this workstream:

- `docs/superpowers/specs/2026-09-16-cmp-telegram-ai-observability-stabilization-design.md`
- `docs/superpowers/plans/2026-09-16-cmp-telegram-ai-observability-stabilization.md`

Immediate-fix PR: `#100` — merged and deployed
Production runtime commit: `98bb917d562a40e212a51bd6eba726ff2d212fbc`

## Safety

No LIVE control was enabled or intentionally modified in this workstream. Continue requiring global/workspace/account LIVE execution OFF through DEMO stabilization.

Fresh post-deploy evidence after PR #100:

- `broker_execution_enabled=true` for DEMO acceptance;
- `live_broker_execution_enabled=false`;
- Mkay workspace: `brokerModes=[demo]`, `liveExecution=false`;
- Starpips Forex workspace: `brokerModes=[demo]`, `liveExecution=false`;
- LIVE cTrader account `4dbe17df-40b0-412a-88de-9bbc562969c7`: `execution_enabled=false`, `live_execution_enabled=false`.

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

The destination itself reported before the fix:

- active: true
- health: `DEGRADED`
- last error: `TELEGRAM_SEND_REJECTED`
- legacy encrypted credential present
- no reusable credential connection currently attached

This proved routing selected Telegram and the Bot API rejected the send. Previous production code discarded Telegram's response description on non-2xx and did not journal the failure per trading event, so the exact Bot API reason for that historical failure cannot be recovered.

### Later GOLD test

Event `telegram:-1004387586337:884` parsed READY and reached broker execution. Valid legs succeeded on both cTrader and MT5. The first SELL leg with TP `4380` failed because that TP was above current ASK/current SELL geometry; cTrader reported `TRADING_BAD_STOPS` and MT5 reported invalid stops. This is correct fail-closed broker behavior for invalid signal geometry, not a platform outage.

Feed `-1004387586337` currently has MT5 and cTrader routes but no Telegram route, so it is intentionally skipped for Telegram under strict selective routing.

## Immediate implementation now deployed

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

Concise side+symbol commands normalize to the existing `NOW` deterministic MARKET path. Existing blocker words still fail closed.

The exact production shape `BUY XAUUSD (CMP)\n\n~~~\nStarpips Forex` is regression-covered. Separator/footer stripping is deliberately limited to messages that actually contain one of the approved current-market aliases, so unrelated messages with separators remain unchanged.

Regression coverage: `tests/cmp_market_aliases.test.mjs`.

### Telegram rejection diagnostics + event journal

`telegram_destination.js` now parses non-2xx Telegram JSON and returns sanitized provider diagnostics:

- providerCode
- providerDescription (bounded/sanitized)
- retryAfter when supplied

No bot token is included in the diagnostic result.

`v1_destination_delivery_acceptance.js` now writes Telegram success/failure to `destination_deliveries` using the existing event/destination idempotency key. Failure rows include normalized error code, failure class, HTTP/provider diagnostics and destination metadata. Journal persistence failure never converts an already-accepted Telegram send into a retryable send, avoiding duplicates.

Forward-as-is is regression-covered to send original source text even when the trading interpretation is `NEEDS_REVIEW`; no AI/cleanup/template reconstruction is invoked for that verbatim route.

Regression coverage: `tests/telegram_delivery_diagnostics.test.mjs` and updated `tests/telegram_destination_adapter.test.mjs`.

## Verification and deployment evidence

Verified PR head: `8e13b0362bd52e3978af240b6a69c554ab2a01ec`.

- Trading V1 CI #2830: SUCCESS — Worker/trading-core, pure MT5 bridge tests and pure MTProto Python tests all green.
- PR #100 merged to main as `98bb917d562a40e212a51bd6eba726ff2d212fbc`.
- Main Trading V1 CI #2831: SUCCESS.
- Production Cloudflare Deploy #88: SUCCESS.
- Production Frontend E2E #93: SUCCESS.
- Production Connection Readiness #51: SUCCESS.
- Production Platform Configuration Verification #50: SUCCESS.
- No database migration was required by the immediate CMP/Telegram patch.

The next real Starpips CMP/Telegram test will now produce per-event Telegram rejection detail if Telegram still rejects the post, making the actual channel/bot/API problem diagnosable instead of collapsing it to `TELEGRAM_SEND_REJECTED` only.

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
8. `UniversalAIRouter.processSignal()` catches provider exceptions and only returns generic `All AI providers failed in cascade.`. It does not persist provider HTTP/auth/quota/model/timeout details, so the root cause of the historical OpenAI failure cannot be recovered from existing records.

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

## Starting point for the next session

1. Read `AGENTS.md` and `CURRENT_HANDOFF.md`.
2. Read this handoff, design and plan.
3. Do not reimplement CMP/Telegram immediate fixes; they are already deployed at `98bb917d...`.
4. Start at Task 3: AI provider architecture and provider diagnostics.
5. Preserve the two-tier Operations/Admin visibility contract while designing the normalized operation journal.
6. Keep LIVE OFF throughout the remaining stabilization and DEMO acceptance.
