# Gate 2 Paid Staging Deployment Trigger

This documentation-only file exists solely to trigger the one-shot Paid Cloudflare staging deployment gate on the reviewed staging feature branch.

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
Read-only staging inspection trigger: 2026-09-06 post-completion GREEN verification.
Paid staging deployment trigger: 2026-09-06 verified completion runtime with fail-closed execution fuses.
Post-deploy Gate 2 acceptance trigger: 2026-09-06 ephemeral simulation, queue/deduplication, Container non-selection, and rollback verification.
Acceptance retry 4: 2026-09-06 assert external Trading access remains fail-closed while internal Queue/dedupe path succeeds with zero broker deliveries.
Acceptance retry 5: 2026-09-06 bounded post-deploy internal-token propagation retry; require eventual authenticated Queue 202 before proceeding.