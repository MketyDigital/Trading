# Gate 2 Paid Staging Deployment Trigger

This documentation-only file exists solely to trigger the one-shot Paid Cloudflare staging deployment gate on the reviewed PR #2 branch.

Safety state for this trigger:
- TradingView direct ingress disabled.
- TradingView certificate probe disabled.
- Trading access disabled.
- Broker execution disabled.
- Free deployment not requested.

The deployment workflow must still pass mandatory CI and its final Paid Wrangler dry-run before any real deployment command can run.

Acceptance trigger: 2026-09-03 Gate 2 queue/simulation/rollback verification.
Acceptance retry: explicit MTProto allowlist + concrete Container instance non-selection verification.
Acceptance retry 2: wait for the newly deployed internal transport secret to be active before Queue acceptance.
Acceptance retry 3: include authorized Telegram native identity on the direct simulation probe.
Deployment trigger: 2026-09-05 MTProto internal source callback configuration.
