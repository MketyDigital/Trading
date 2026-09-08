# Trading Launch Console, Destinations and MTProto Design

## Status

Approved by owner on 2026-09-07 for implementation on `feature/trading-launch-console-destinations-mtproto`.

## Goal

Complete the Mkety Trading launch layer so the owner can create enterprise access, configure sources and destinations, choose Telegram formatting/branding, set up MTProto correctly, see trading/risk capabilities, deploy safely, and run end-to-end manual testing while broker execution remains disabled.

## Non-negotiable safety rules

- Repository boundary: `MketyDigital/Trading` only.
- Do not touch MkSaaS.
- `BROKER_EXECUTION_ENABLED` remains `false` through this work.
- Do not commit credentials, Telegram sessions, Cloudflare keys, Supabase keys, broker tokens, or userbot sessions.
- Do not return raw stored secrets from API responses.
- AI may change message presentation only. It must not alter canonical trade semantics: symbol, side, order type, entry, stop loss, take profits, volume, risk, or management action.
- Server-owned database records remain authority. Caller workspace/source/account/destination hints are never authority.

## Personas

### Mkety admin

Mkety admin is an internal operator. This user creates enterprise owner access codes and can inspect redemption state. Mkety admin is not the enterprise customer.

### Enterprise owner

Enterprise owner is the customer who redeems an access code and manages a Trading workspace: sources, destinations, formatting, AI providers, accounts/risk, domains and audit.

## Current foundation

Existing V1 already contains:

- access-code redemption endpoint;
- workspace and membership stores;
- source management API;
- account/risk controls API;
- hostname API;
- operations/audit API;
- event ingest with source signature verification;
- deterministic parser plus optional workspace AI;
- simulation orchestration;
- production execution stage guarded by global and account safety locks;
- MTProto provider registry entries for external VM, Cloudflare Container and Cloudflare Durable Object.

The missing launch layer is owner/admin visibility and destination routing/configuration.

## Correct MTProto model

### External VM MTProto

External VM MTProto supports existing or ready-made userbots. Mkety must not collect Telegram `apiId`, `apiHash` or `session` for this provider.

Mkety creates a source connection and gives the owner/userbot operator:

- source ID;
- Worker event endpoint;
- source signing secret or internal handoff token depending on chosen mode;
- expected JSON payload contract;
- sample curl request;
- destination routing status.

The VM/userbot remains responsible for logging into Telegram, reading source channels and choosing which Telegram messages to send. The Worker verifies source identity and processes the payload.

### Cloudflare Container MTProto

Mkety-hosted Telegram listener. This mode collects Telegram API credentials and session, encrypts them with `TRADING_MASTER_KEY`, stores only ciphertext, and manages runtime lifecycle/status.

### Cloudflare Durable Object MTProto

Mkety-hosted Telegram listener using Durable Object runtime. Same credential handling as container mode, with runtime status and recovery actions.

## Sources

Supported source provider types:

- `external_mtproto` — handoff-only external VM/userbot;
- `cloudflare_container_mtproto` — Mkety-hosted container Telegram listener;
- `cloudflare_do_mtproto` — Mkety-hosted DO Telegram listener;
- `tradingview_webhook` — TradingView alert webhook;
- `custom_signed_api` — generic signed source API;
- `mt5_source_bridge` — MT5 source bridge;
- `ctrader_source` — cTrader source stream.

Source creation must show the credential expectations by provider. External VM must show no Telegram credential fields.

## Destinations

Create a V1 destination model with these types:

- `telegram` — post formatted message to a Telegram chat/channel/group;
- `broker_account` — route canonical execution plans to a configured account, still blocked while global broker fuse is off;
- `internal_webhook` — send canonical payload to an internal/external API endpoint with a signing secret;
- `audit_only` — record output only without external delivery.

Destination records must be workspace-scoped and never globally reusable across workspaces.

## Source-to-destination routing

Owners must link one source to one or more destinations. Routes can be enabled/disabled and ordered. A source can route to Telegram only, broker only, both, audit-only, or none.

Routing authority comes from persisted workspace-scoped records. Payload-supplied destination hints are ignored.

## Telegram formatting modes

Telegram destination supports four formatting modes:

- `none`: preserve source text as much as possible;
- `clean`: remove footer/source branding/links per owner rules while preserving trade values;
- `template`: deterministic branded output from canonical intent;
- `ai_then_fallback`: request AI presentation rewrite, validate semantics, fallback to deterministic template on slow/failure/semantic drift.

Owners can configure:

- brand name;
- header;
- footer/disclaimer;
- emoji style;
- whether to remove source footers/links;
- parse mode `HTML` or plain text;
- delivery enabled/disabled.

## AI provider controls

Expose workspace AI provider configuration safely:

- provider name;
- model name;
- base URL if applicable;
- priority rank;
- active state;
- credential configured boolean;
- credential replacement form.

Do not display stored API keys. New writes should use encrypted ciphertext where supported.

## Mkety-admin access-code manager

Add an internal Mkety admin API/screen for creating/listing/revoking access codes. Admin creates:

- owner email;
- owner name;
- workspace display name;
- expiry;
- max redemptions;
- source type entitlements;
- destination entitlements;
- broker modes;
- live execution entitlement;
- custom hostname entitlement;
- max team members.

Plain code is generated and returned once. Database stores only normalized SHA-256 hash. Listing never reveals plaintext code.

## Domains

Keep canonical app entry as `trade.mkety.com`. Custom hostnames remain optional routing context only, not authorization. UI must explain DNS/CNAME requirements and show provider configuration/readiness. Do not enable production custom hostnames unless `TRADING_CUSTOM_HOSTNAMES_ENABLED=true` plus Cloudflare zone/target values are configured.

## Trading/risk inventory

Dashboard must show current supported logic so the owner can test knowingly:

- signal classification: new signal, management, non-actionable/needs review;
- supported sides: BUY, SELL, LONG, SHORT;
- supported orders: MARKET, LIMIT, STOP, STOP_LIMIT;
- entries: market, price, range, fast/incomplete;
- signal fields: symbol, entry, stop loss, take profits;
- management: move SL to BE, close half, cancel pending, close all, close;
- sizing modes: fixed lots, risk percent, fixed risk amount;
- account policy: kill switch, allowed symbols, max lots, max risk, daily loss, open risk;
- execution actions: open position, modify position, close partial, cancel pending, close position;
- broker platforms: MT5 and cTrader account config; legacy Deriv executor exists but must not be exposed as ready production broker until it has explicit production authority and tests.

## Manual end-to-end test path

After implementation/deploy:

1. Mkety admin creates access code.
2. Enterprise owner redeems access code.
3. Owner opens launch console.
4. Owner creates source:
   - external VM MTProto handoff, or
   - Cloudflare Container/DO MTProto with credentials, or
   - custom signed API for fast test.
5. Owner creates Telegram destination.
6. Owner chooses formatting mode.
7. Owner maps source to destination.
8. Owner sends a test signal from source.
9. Worker verifies, parses, formats and routes the event.
10. Destination delivery is recorded and, for Telegram, posted if configured credentials are valid.
11. Owner checks operations/audit.
12. Broker execution remains blocked because global fuse is off.

## Deployment rule

Implement on branch, test, open PR, merge only after green CI, apply DB migration, deploy through GitHub Actions with `BROKER_EXECUTION_ENABLED=false`, then the owner performs real manual testing.
