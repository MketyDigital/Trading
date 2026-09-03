# Gate 3 TradingView Acceptance Trigger

This documentation-only file is the dedicated trigger path for controlled Gate 3 Cloudflare actions on PR #2.

Current phase: genuine TradingView client-certificate observation on the dedicated probe hostname.

Dedicated hostname:
- `tradingview.mkety.app`

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

A genuine TradingView webhook is required during the bounded real-time tail window. If Cloudflare does not expose one stable normalized SHA-256 client-certificate fingerprint, Gate 3 stops without weakening transport authentication.
