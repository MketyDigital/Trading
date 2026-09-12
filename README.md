# Mkety Trading

Standalone enterprise trading workspace for Mkety.

The Cloudflare Worker is the authoritative orchestration layer for source authentication, deterministic canonical signal processing, persisted routing, account/risk enforcement, destination delivery and broker dispatch. Customer-specific configuration is stored in Supabase and must never be trusted from caller payload hints.

## Production

Customer entry: `https://trade.mkety.com/`

Current production status and remaining external-infrastructure acceptance work are recorded in `CURRENT_HANDOFF.md`. Read `AGENTS.md` before making runtime or production changes.

## Major components

- `cloudflare-v2/` — Worker, APIs, database migrations, portal, trading core, MTProto runtime and MT5 compatibility bridge.
- `ctrader-cbot/` — Mkety Cloud Auto Trader cBot.
- `ctrader-cbot-gateway/` — shared outbound cTrader/MT5 transport gateway for Azure/Coolify.
- `mt5-connector/` — paired outbound Windows MT5 Connector.
- `docs/` — architecture, operator/customer manuals, production runbooks and implementation history.
- `.github/workflows/` — CI, production deployment, browser E2E and broker connector release gates.

## Safety boundaries

- Never commit or expose real broker credentials, Telegram sessions, API keys, access tokens or platform secrets.
- AI presentation must not alter canonical trading semantics.
- Persisted workspace/source/route/account/risk state is authoritative.
- Broker execution requires every applicable deployment, owner, route, account, execution, kill-switch, risk and symbol gate to pass.
- Production deployment preserves the owner's persisted runtime-control choice; it does not silently rewrite it.

See `CURRENT_HANDOFF.md` for the verified current release and exact next operational step.
