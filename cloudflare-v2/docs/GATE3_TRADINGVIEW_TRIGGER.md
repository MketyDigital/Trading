# Gate 3 TradingView Acceptance Trigger

This documentation-only file is the dedicated trigger path for controlled Gate 3 Cloudflare actions on PR #2.

Current phase: genuine TradingView client-certificate observation on the dedicated Trading hostname.

Trading hostname:
- `trade.mkety.com`
- Cloudflare zone: `mkety.com`

Product-domain boundary:
- Trading infrastructure and this Gate 3 probe use `trade.mkety.com`.
- `mkety.app` is reserved for customer-owned apps/builds under the main Mkety/MKSaaS product and must not be used for Trading infrastructure.
- The Gate 3 workflow contract is pinned to this boundary and rejects the former `tradingview.mkety.app` target.

Safety posture for this probe:
- TradingView direct ingress remains disabled.
- TradingView certificate probe is enabled only temporarily by the exact-marker workflow.
- Trading access remains disabled.
- Broker execution remains disabled.
- Container rollout is disabled.
- Hostname/DNS conflicts are checked read-only before deployment.
- Caller-spoofed certificate headers must still receive HTTP 403.
- Only sanitized Cloudflare-observed certificate metadata may appear in the probe tail.
- The Worker must roll back to the known-safe Paid version after the probe window.

The active-zone inventory already verified that the connected Cloudflare account owns `mkety.com`. A genuine TradingView webhook is required during the bounded real-time tail window. If Cloudflare does not expose one stable normalized SHA-256 client-certificate fingerprint, Gate 3 stops without weakening transport authentication.
