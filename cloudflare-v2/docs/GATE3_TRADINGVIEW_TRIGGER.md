# Gate 3 TradingView Acceptance Trigger

This documentation-only file is the dedicated trigger path for controlled Gate 3 Cloudflare actions on PR #2.

Current phase: coordinated genuine TradingView client-certificate observation with sanitized arrival diagnostics.

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
- Only sanitized Cloudflare-observed probe counts and certificate metadata may appear in the probe tail/result.
- The Worker must roll back to the known-safe Paid version after the probe window.

First real probe evidence:
- run `33728657084`, job `100563529178`;
- temporary probe deployment and spoof rejection succeeded;
- zero usable certificate fingerprints were observed;
- rollback succeeded to the known-safe Worker at 100% traffic.

The first run could not distinguish a missing genuine TradingView request from a genuine request with no Cloudflare-exposed client certificate. The next controlled probe therefore reports only sanitized counts: `totalProbeLogs`, `expectedSpoofLogs`, `additionalProbeLogs`, `certPresentedCount`, and `fingerprintCount`.

A genuine TradingView webhook must be fired from TradingView itself during the bounded real-time tail window to:

`https://trade.mkety.com/api/v1/webhooks/tradingview/probe`

Browser, curl, or Postman requests do not count as genuine TradingView evidence. If Cloudflare does not expose exactly one stable normalized SHA-256 client-certificate fingerprint, Gate 3 stops without weakening transport authentication.
