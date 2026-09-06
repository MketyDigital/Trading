# Gate 5 MTProto Soak Acceptance Trigger

This file is the deliberate trigger surface for the protected Gate 5 non-live Telegram MTProto soak/recovery workflow.

## What Gate 5 proves

Gate 5 converts the three CI-proven Telegram MTProto provider implementations into real non-live runtime evidence for:

- `cloudflare_container_mtproto`;
- `cloudflare_do_mtproto`;
- `external_mtproto`;
- new and edited Telegram message receipt from a dedicated test Telegram account/channel;
- canonical Telegram identity convergence;
- disconnect/restart/reconnect recovery;
- catch-up replay without second orchestration;
- duplicate collapse;
- downstream failure isolation between providers/sources;
- cross-provider convergence for the same native Telegram message;
- Container isolation: DO/external activity must never touch/start the Container runtime, while the exact active Container provider may.

The protected runner is observation-only. It polls deliberately prepared sanitized health/event observation endpoints for the three provider sources and fails closed unless the required recovery/isolation evidence is present.

## Safety boundary

The protected job must run with:

```text
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Gate 5 must not deploy Workers, mutate Cloudflare/Supabase/Zitadel configuration, create broker destinations, place demo/live broker orders, or enable real Trading access. Test Telegram sessions, API credentials and bearer values are supplied only through the protected GitHub `staging` environment and must never be printed.

Observation output may contain provider type, opaque source id, health state, reconnect/catch-up/edited/duplicate counts, isolation booleans and pass/fail reasons. It must not contain Telegram session strings, API hash/API ID, phone number, message body, bearer token, signing key, broker credentials, or raw canonical Telegram identities. Canonical identities are compared through SHA-256 digests only.

## Required staging preparation

Before a real Gate 5 run is authorized:

1. Use a dedicated non-production test Telegram account and test channel/chat.
2. Configure one enabled test source for each provider type in the same controlled workspace/account scope where cross-provider convergence will be tested.
3. Confirm all three sources point to the intended test Telegram identity and that no broker destination is enabled.
4. Prepare sanitized health/event observation endpoints for each source. The event observer must expose canonical event identity to the runner but must not expose message bodies or credentials.
5. During the soak window, send at least one new signal-like test message and one edited message.
6. Deliberately disconnect or restart each provider runtime and allow it to reconnect/catch up.
7. Ensure the replayed native message is observed again so the runner can prove duplicate collapse after recovery.
8. Inject one temporary downstream failure for one provider/source and confirm sibling providers remain healthy; expose only the sanitized `downstreamIsolationObserved` evidence flag.
9. Observe the same native Telegram message through at least two provider paths so cross-provider duplicate convergence can be proven.
10. For Container isolation, expose `containerTouched=true` only for the exact active Container provider when it actually reaches Container runtime. DO/external observers must remain `containerTouched=false`.

The existing persistent idempotency and recovery state must remain enabled throughout the soak.

## Acceptance evidence

For every provider the runner requires:

- final healthy/connected state;
- at least one reconnect observation;
- at least one catch-up observation;
- at least one duplicate replay observation;
- at least one edited-message observation;
- downstream failure isolation evidence.

Across providers it additionally requires:

- at least one shared canonical-event SHA-256 digest observed through two or more provider paths;
- Container touched only by the Container provider and never by DO/external providers.

Failure of any required proof keeps Gate 5 RED/PENDING. Do not claim zero-loss behavior beyond the exact observed soak window.

## Deliberate trigger

Only after the staging configuration and test actions above have been reviewed and real Gate 5 execution has been explicitly authorized, update this trigger file and push a commit whose **entire commit message is exactly**:

```text
source: accept mtproto gate 5
```

The protected workflow first runs the ordinary Node/MT5/MTProto regression suite. Only if it passes, the exact branch/message marker matches, and the GitHub `staging` environment allows the job will the real observation-only MTProto acceptance runner execute.

Merely adding or editing this workflow, runner, package command, or runbook does not authorize or trigger a real Gate 5 soak.

Acceptance attempt: 2026-09-06 production-readiness audit with Trading access and broker execution disabled.
Acceptance attempt: 2026-09-06 production path after Gate 4 blocked on missing identity staging secrets.
