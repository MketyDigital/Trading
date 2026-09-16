# CMP, Telegram, AI Provider and Operations Observability Stabilization Design

Date: 2026-09-16
Status: Approved in chat
Branch: `fix/cmp-telegram-ai-observability-stabilization`

## Goals

1. Recognize common Current Market Price shorthand deterministically so concise market commands do not depend on AI.
2. Preserve Telegram Forward-as-is delivery independently from trading interpretation where the selected Telegram destination mode is `none`.
3. Record every destination/trading operation outcome with a useful reason.
4. Give customers a sanitized workspace Operations view containing only their own sources, feeds, routes, Telegram, MT5, cTrader, broker accounts, terminals/VPS-facing connection state, AI providers they configured, trades, management and delivery outcomes.
5. Give Mkety Admin a site-wide diagnostic view with full internal component/provider/error context needed for support.
6. Make AI provider configuration database-authoritative with encrypted credentials and no provider credential/config dependency on runtime environment variables.
7. Support first-class OpenAI, Azure OpenAI, Google Gemini API, Google Vertex AI, Cloudflare AI and AWS Bedrock provider adapters.
8. Preserve all mature execution, management, reply/follow-up, routing, symbol-catalog, replay, reconciliation and safety behavior.
9. LIVE remains disabled during stabilization/DEMO acceptance.

## Production findings that triggered this work

- Event `telegram:-1003902892609:312`, text `BUY XAUUSD (CMP)`, persisted as `NEEDS_REVIEW` with `All AI providers failed in cascade.` No broker execution occurred.
- The source feed has valid broker and Telegram routes.
- Telegram destination `telegram real vip2` is active but currently reports `DEGRADED / TELEGRAM_SEND_REJECTED`.
- Current destination outcome storage updates only destination health for Telegram failure, so the exact Telegram API rejection is not durably visible per event.
- Starpips currently has one active AI provider row: OpenAI `gpt-5.6-luna`, encrypted key present, plaintext key absent.
- Current UniversalAIRouter collapses provider exceptions into the generic cascade failure and therefore hides auth/quota/model/HTTP/timeout/root-cause detail.
- Current router has direct OpenAI, Gemini and Cloudflare AI paths plus generic OpenAI-compatible fallback. Azure OpenAI, Vertex AI and Bedrock are not first-class provider implementations.
- Cloudflare AI currently permits an env fallback for account ID. New architecture must read provider account/project/region/deployment configuration from encrypted/database provider configuration instead.

## CMP deterministic contract

A concise command containing an unambiguous side + supported symbol + a known current-market alias is a MARKET fast-entry signal.

Recognized aliases must include at minimum:
- CMP
- C.M.P
- CURRENT MARKET PRICE
- CURRENT MKT PRICE
- CURRENT PRICE
- MARKET PRICE
- AT MARKET
- CURRENT MARKET
- MKT PRICE
- NOW / MARKET (existing behavior)

Examples such as `BUY XAUUSD (CMP)`, `SELL GOLD @ CURRENT MARKET PRICE`, `BUY EURUSD AT MARKET` are deterministic MARKET intents with `entry.kind=MARKET`, `fastEntry=true`, `incomplete=true` when SL/TP are absent.

The concise-command safety gate remains: commentary/question/hedging blocker words still fail closed.

## Telegram Forward-as-is contract

If a routed Telegram destination resolves to `formatting_mode='none'` (or destination settings explicitly override to `none`):
- send exact source text and Telegram entities where safe;
- do not require successful trading interpretation;
- do not invoke AI, cleanup, canonical signal reconstruction, brand/header/footer insertion;
- preserve reply/thread mapping behavior;
- record success/failure per event.

Structured template and AI formatting modes may still require interpretation as they do today.

## AI provider architecture

Provider rows are authoritative. New provider writes must store secrets encrypted in `api_key_ciphertext` or a provider-specific encrypted credential envelope. Plaintext credential columns are compatibility-read only and must not be used by new writes.

Provider-specific non-secret configuration belongs in database fields/config, not environment variables:
- OpenAI: API key, model, optional base URL.
- Azure OpenAI: API key or supported credential, endpoint, deployment/model, API version.
- Gemini API: API key, model.
- Vertex AI: project, location, model and encrypted service-account/credential material where required.
- Cloudflare AI: account ID, model and encrypted API token; no account-ID env fallback.
- AWS Bedrock: region, model ID and encrypted AWS credential/role configuration appropriate to the deployment model.

Each provider call returns a normalized internal diagnostic result containing provider id/type/model, latency, outcome, HTTP/provider status/code, retryability, timeout/circuit state and sanitized message. Secrets and raw authorization values are never persisted in diagnostics.

## Two-tier observability

### Customer Operations

Workspace-scoped only. Never expose infrastructure implementation names such as Cloudflare Workers, OCI, Coolify, Azure hosting, internal queues, service names or database internals.

Customer-visible vocabulary may include only concepts they own/use: Source, Source channel/feed, Route, Telegram, MT5, cTrader, Broker account, MT5 terminal, VPS/connector, AI provider/model, Signal, Trade, Management action, Destination.

Examples:
- `Telegram delivery failed — bot cannot post to destination channel.`
- `MT5 execution failed — broker rejected stop levels.`
- `AI interpretation unavailable — OpenAI provider request failed.`
- `Route skipped — this source channel is not selected for MT5.`
- `Trade succeeded — cTrader DEMO order accepted.`

Do not expose secrets, provider account IDs where unnecessary, stack traces, infrastructure URLs, internal component names or other customers.

### Mkety Admin Operations

Site-wide and support-oriented. It may expose internal infrastructure/component/provider context, exact normalized error codes, provider HTTP status, retryability, circuit state, correlation IDs, route/feed IDs, workspace IDs, destination/account IDs and sanitized provider descriptions necessary for troubleshooting. Still never expose plaintext secrets/tokens/passwords.

## Durable operation journal

Every meaningful stage should have durable evidence: ingress/auth, normalization/interpretation, AI provider attempts, source/feed resolution, route select/skip, destination attempt, Telegram result, broker planning, broker execution, management, replay/reconciliation and terminal/connector state.

Customer and admin views read the same underlying normalized operation journal through different serializers/redaction policies.

## Non-regression scope

Must remain intact: fast completion, management, replies/non-replies, TP/SL/BE, partial/full close, pending cancellation, MTProto/Bot API correlation, Forward-as-is, all routing semantics, reusable Telegram credentials, MT5/cTrader, multi-terminal MT5, capability-driven broker/symbol support, all authoritative catalog-supported markets, independent fanout, replay/idempotency, reconciliation/repair-state, sibling isolation, access/subscription lifecycle.

LIVE stays globally/workspace/account disabled throughout this stabilization work.
