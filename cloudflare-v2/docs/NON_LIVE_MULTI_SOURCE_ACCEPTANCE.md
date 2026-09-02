# Non-live Multi-source Acceptance and Operational Gate

This runbook closes implementation-plan Task 9 for `cloudflare-v2` and records the current non-live source boundary. It is deliberately non-live. It does not authorize real broker execution, does not replace the broker demo acceptance gates, and does not relax the shared-Supabase or multi-tenant isolation rules in `AGENTS.md`.

## Preconditions

Before any environment run:

- inspect the real shared Supabase schema before applying checked-in Trading migrations;
- keep unrelated Mkety tables unchanged;
- keep `trading_access_enabled=false` until the intended Zitadel organization/role mapping is configured and independently verified;
- keep real-money execution disabled;
- use test Telegram accounts/channels and non-live Trading sources only;
- never place secret values in Git, chat, command output, health responses, or acceptance summaries;
- for TradingView, never place reusable source secrets in the webhook URL/query/body and never treat caller workspace/source/destination/execution fields as authority;
- Cloudflare Free compatibility is the baseline for the Trading trust boundary. Do not introduce BYOCA, Enterprise mTLS trust, or any other Enterprise-only Cloudflare dependency. Workers Paid may improve capacity and may host the optional Container MTProto provider, but must not be required for security correctness when a Free-compatible route exists.

Verified Trading-owned Supabase state as of 2026-09-02:

- migrations through `trading_0010_tradingview_public_source_handle` are applied;
- `0010` ledger version is `20260902184215`;
- `source_connections.public_source_handle` is nullable `text`;
- `idx_source_connections_public_source_handle` is a unique partial index for non-null handles;
- `anon` and `authenticated` retain no table privileges on `source_connections`; `service_role` retains required access;
- no TradingView source row, broker credential, destination, or execution setting was created by migration `0010`.

## Static/CI gate

The exact acceptance suite must prove all of the following before environment testing:

1. Multiple source/provider families coexist without a global provider dependency.
2. A source/provider failure is scoped to that source/workspace and does not mutate sibling authorization, credentials, health, retry state, defaults, or canonical identity.
3. Container, Durable Object, and external MTProto replays converge on provider-independent Telegram native identity inside one workspace only.
4. Recovery/catch-up replay cannot create a second interpretation/orchestration path for the same persistent canonical event.
5. Destination fan-out is workspace scoped: one destination failure does not block or roll back successful siblings.
6. Retry can target only failed destinations; already successful siblings are not redispatched.
7. A foreign-workspace destination is rejected locally without preventing valid sibling destinations from running.
8. Duplicate destination identifiers are rejected independently instead of being dispatched twice.
9. Sanitized results contain fixed error codes/health fields only and never echo provider, source, Telegram-session, destination, broker, signing, or database credential values.
10. TradingView direct ingress remains source-only: transport verification precedes acceptance, exact server-side public-handle lookup establishes source authority, stable native `event_id` is required, forbidden authority/credential hints are removed, and accepted work is queued into the existing source-event path only.
11. A TradingView source/queue failure never suppresses another TradingView handle or Telegram/MT5/cTrader/custom source.
12. Existing signed `/api/v1/events` HMAC behavior remains independent and unchanged by the TradingView route.
13. All four mandatory CI gates pass at the same exact branch head: Node Worker/trading-core, pure MT5 bridge, both MTProto Python suites, and Wrangler dry-run. The Wrangler gate must dry-run both `wrangler.toml` and `wrangler.free.toml`.

Key TDD/CI checkpoints:

- destination fan-out RED: run `33630032190` at `7c27ca546602b48fcbfa7b1db8051f6e4469af0f`; 378 tests passed and the only failure was missing `src/destinations/destination_fanout.js`;
- destination fan-out GREEN: run `33630219329` at `fa253f04eba80354781a91474a237ebd02c51f34`; all four mandatory gates passed;
- MTProto soak harness GREEN: run `33629585665` at `276abbc362c03703d897f1410f1eeb534ff75b07`;
- TradingView duplicate-contract RED: run `33668236026` at `7cd66319e312856bceb5255ff0cbb15ecf5930d0`; 490/493 Node tests passed and the only failures were newly added tests using alternate names instead of the already implemented `public_source_handle` contract;
- TradingView reconciliation GREEN: run `33668462127` at `8e83294d0578e0278b5f3eea7037faa305fe1503`; all four mandatory gates passed;
- post-Supabase handoff GREEN: run `33668981424` at `3626cbe3191c9e95cc9bc5f7a63ee76859efe90e`; all four mandatory gates passed after live migration `0010` verification was recorded;
- Free-compatible TradingView transport RED: run `33677097755` at `1f5a04130097df8c20d9ba8843909926bcff21ef`; exactly the two new cases that no longer require Cloudflare CA verification failed while production still required `certVerified='SUCCESS'`;
- Free-compatible TradingView transport GREEN: run `33677199850` at `6531589c3f5106cf5dddc91080feb34698d09716`; all four mandatory gates passed after removing the Enterprise-dependent Cloudflare CA-verification requirement while retaining presented-certificate and exact SHA-256 fingerprint pinning;
- fail-closed certificate probe RED: run `33683387828` at `09959c829d4a975cc8873b7fc125939da3c0ca86`; 496/498 Node tests passed and only the two new probe-observation cases failed because no probe log existed yet;
- fail-closed certificate probe GREEN: run `33683493798` at `84bd40e8c714b884f003869693203ea0148e0b85`; Worker/trading-core, MT5 bridge, both MTProto Python suites, and Wrangler dry-run all passed;
- Free-baseline Wrangler RED: run `33691357344` at `9d0dafbd097364a96ae153d0252c1d5548d2842c`; 498/499 Node tests passed and the sole failure was the intentionally missing `wrangler.free.toml`;
- Paid+Free deployment GREEN: run `33691531352` at `07753802ed80dace07376c3a738d3ff03edcfaa7`; all four mandatory gates passed, and the Wrangler gate successfully dry-ran both deployment configs.

## MTProto deployment profiles

The three Telegram provider types remain independent: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, and `external_mtproto`.

### Workers Paid profile

`cloudflare-v2/wrangler.toml` is the Workers Paid deployment config. It retains the optional `MtprotoContainerRuntime` and `MTPROTO_CONTAINER_NAMESPACE` binding. The existence of that binding is **not** permission to start a Container and is not provider selection.

A Container may be resolved/started only after server-side source resolution proves all of the following for the exact trusted source/workspace:

- `source_family='telegram'`;
- `provider_type='cloudflare_container_mtproto'`;
- `is_active=true`.

Wrong-provider, disabled, missing, or foreign-workspace sources must fail before the Container namespace is touched. DO/external sources must never start a Container merely because the Paid Worker has the binding.

### Free-compatible profile

`cloudflare-v2/wrangler.free.toml` is a separate deployment target named `mkety-copier-engine-free`. It intentionally contains:

- no `[[containers]]` declaration;
- no `MTPROTO_CONTAINER_NAMESPACE` binding;
- no Container Durable Object migration;
- no one-minute Container recovery cron;
- the non-Container Durable Object bindings needed by the Worker;
- isolated `mkety-trading-source-events-free` / DLQ queue names;
- the ordinary 15-minute scheduler.

The Free profile's queue names are intentionally separate from the Paid profile so an accidental simultaneous deployment cannot distribute one source-event queue across two Workers.

The one-minute cron is absent because it supervises the optional Container recovery path. DO/external provider recovery must remain provider-local and must not require a fake or missing Container binding.

Environment acceptance for either profile must verify that selecting one Telegram provider cannot mutate/start another provider's runtime, credentials, retry state, or health.

## MTProto soak command

From `cloudflare-v2/`:

```text
npm run soak:mtproto:container
```

The soak harness is observation-only. It must not invoke a broker executor or a live-trading switch. Environment validation is explicit opt-in and reports missing configuration names only. Record per-source connectivity/health transitions, reconnect observations, event latency, catch-up observations, and duplicate/canonical-identity observations.

Do not interpret a static GREEN harness as proof that real Cloudflare Container session/update-state recovery is lossless. Cloudflare Container disk is ephemeral; real reconnect/restart/catch-up behavior must still be exercised with a test Telegram account/channel and durable downstream idempotency enabled.

## Controlled non-live environment matrix

Use at least two independent workspaces or source identities when practical so isolation is observed rather than assumed.

### Source/provider isolation

- Send a valid test event through source A while source B is healthy; both should operate independently.
- Inject a retryable failure into source A transport/downstream path; source B must continue without authorization, health, retry, or queue-state changes.
- Disable/revoke source A; source B must remain operational.
- Attempt a caller workspace/source override; trusted server-side source/workspace identity must remain authoritative.
- On a Paid deployment with the Container binding present, exercise a DO or external source and confirm no Container is started/touched for that source.
- On the Free deployment profile, confirm the Worker dry-runs/starts without any Container binding and Container-only recovery is absent.

### TradingView direct-ingress transport gate

Direct TradingView staging is intentionally fail-closed. Do not enable it merely because the route exists. The transport design must remain usable on Cloudflare Free; Enterprise-only BYOCA or Enterprise mTLS trust is explicitly out of scope.

#### Cloudflare Free hostname configuration

For the dedicated TradingView hostname, the intended Cloudflare configuration is certificate **collection/forwarding to the Worker**, not Cloudflare CA authorization of TradingView:

- enable client-certificate/mTLS collection for the dedicated hostname using Cloudflare functionality available without Enterprise BYOCA;
- do **not** upload or depend on TradingView's CA through BYOCA;
- do **not** add a WAF rule that requires `cf.tls_client_auth.cert_verified` / `certVerified='SUCCESS'` for this route, because TradingView's certificate is not expected to chain to the Cloudflare-managed client-certificate CA;
- allow the request to reach the Worker so trusted `request.cf.tlsClientAuth` metadata can be evaluated there;
- the Worker remains the authorization gate: it requires `certPresented === '1'` plus an exact configured SHA-256 fingerprint match;
- ordinary HTTP headers, source IP, subject/CN/SAN strings, and Cloudflare `certVerified` status are not sufficient authority by themselves;
- keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED` disabled during certificate observation. Certificate collection is not permission to queue an event.

If the Cloudflare plan/dashboard cannot expose the required certificate presentation/fingerprint metadata without an Enterprise-only feature, stop. Do not upgrade the trust boundary to Enterprise and do not weaken authentication.

#### Temporary fail-closed certificate probe

The Worker includes a temporary observation mode controlled by `TRADINGVIEW_CERT_PROBE_ENABLED`. This is not an authorization mode and must remain disabled during normal operation.

When `TRADINGVIEW_CERT_PROBE_ENABLED` is true:

- every POST reaching the TradingView webhook handler returns `403 TRADINGVIEW_TRANSPORT_NOT_VERIFIED` before normal transport verification;
- the handler does not parse the public source handle or request body, does not construct a Supabase client, does not perform source lookup, and does not enqueue anything;
- even if `TRADINGVIEW_DIRECT_INGRESS_ENABLED` is accidentally true at the same time, probe mode wins and the request still terminates at 403;
- the only observation emitted is `TRADINGVIEW_CERT_PROBE` with `certPresented`, `fingerprintAvailable`, and the normalized SHA-256 fingerprint when and only when Cloudflare reports a certificate as presented;
- subject/issuer values, request/body content, source/workspace identifiers, credentials, broker data, and caller-supplied certificate headers are never part of the probe observation;
- spoofed ordinary HTTP headers cannot create or replace the observed fingerprint because the probe reads only `request.cf.tlsClientAuth`;
- disable the probe immediately after the controlled real TradingView observation is recorded.

Controlled observation sequence:

1. Confirm the deployed Worker has the expected TradingView route and keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`.
2. Confirm the dedicated hostname is configured only to collect/pass client-certificate metadata to the Worker; verify there is no BYOCA dependency and no WAF rule requiring `cert_verified` for the TradingView route.
3. Temporarily set `TRADINGVIEW_CERT_PROBE_ENABLED=true` while keeping direct ingress disabled.
4. Send a spoof-only request first. Expect HTTP 403 and either `certPresented:false` with no fingerprint or no genuine presented-certificate observation. Caller certificate headers must not become the logged fingerprint.
5. Trigger one real TradingView HTTPS webhook and inspect only the sanitized `TRADINGVIEW_CERT_PROBE` observation. Require `certPresented:true`, `fingerprintAvailable:true`, and one normalized 64-hex SHA-256 fingerprint.
6. Repeat only as needed to establish that the TradingView-observed fingerprint is stable. If it is absent, malformed, or unstable, stop and redesign.
7. Disable `TRADINGVIEW_CERT_PROBE_ENABLED` immediately after observation. Confirm the probe is off before proceeding.
8. Validate the observed fingerprint through the controlled non-secret certificate-observation process, then configure only that validated fingerprint through the secret/environment management path. Never paste it alongside unrelated secrets or source credentials.
9. Before enabling ingress, confirm an unconfigured fingerprint remains rejected. The existing transport test contract requires `TRADINGVIEW_TRANSPORT_NOT_VERIFIED` for a presented but unpinned certificate, including when `certVerified` reports an issuer-verification failure.
10. Enable `TRADINGVIEW_DIRECT_INGRESS_ENABLED` only for controlled non-live acceptance after certificate presentation/fingerprint behavior is proven and the probe is disabled.
11. Create one non-execution `tradingview_webhook` source row with a unique `public_source_handle`. Do not attach a broker/destination and do not enable any trade account as part of ingress verification.
12. Post a valid TradingView alert with a stable `event_id`; expect HTTP `202` and one queue envelope for the exact resolved source.
13. Repeat the same native `event_id`; confirm persistent canonical duplicate handling prevents second interpretation/orchestration work.
14. Include malicious `workspace_id`, `source_id`, destination, broker, execution, token, password, credential and API-key-like fields at nested levels; confirm they never become authority or appear in the queued source event.
15. Test a second source handle/workspace. Failure or disablement of source A must not change source B's source resolution, queueing, idempotency, health, or credentials.
16. Turn direct ingress back off after the controlled test unless there is a separate reviewed decision to keep staging enabled.

The Worker-side transport gate requires all of the following after probe mode is disabled: the direct-ingress feature flag, a configured SHA-256 allowlist, `request.cf.tlsClientAuth.certPresented === '1'`, and an exact normalized match of `certFingerprintSHA256`. It deliberately does not trust ordinary HTTP headers and does not require Cloudflare to validate TradingView's external CA.

Do **not** substitute an IP-only allowlist, caller-supplied verification header, query-string secret, body secret, subject/CN/SAN comparison, or `certVerified` status for the fingerprint gate. If Cloudflare does not expose stable verifiable TradingView client-certificate metadata in the real Free-compatible environment, keep direct ingress disabled and revisit the trust-boundary design rather than weakening it.

### Reconnect/catch-up/replay

- Deliver one Telegram test message and confirm one persistent canonical event/orchestration.
- Restart/disconnect the selected MTProto runtime.
- Replay/catch up the exact native message and confirm terminal duplicate handling with no second orchestration/destination work.
- Deliver the next Telegram message id and confirm it proceeds once as a distinct canonical event.
- Where two Telegram providers observe the same native event, confirm they converge on `telegram:<accountScope>:<chatId>:<messageId>` only inside the same workspace.

### Destination fan-out isolation

Use non-broker/simulation destinations for this gate.

- Configure at least three same-workspace destinations.
- Make one destination fail and verify the other destinations complete independently.
- Retry only the failed destination and verify successful siblings are not redispatched.
- Include a foreign-workspace destination and verify it is rejected locally while valid siblings continue.
- Include a duplicate destination id and verify only the first instance is dispatched.
- Confirm returned/recorded failure information is sanitized and does not echo underlying exception text or credentials.

## Stop conditions

Stop the environment acceptance immediately if:

- any unrelated Mkety/shared table is altered;
- one workspace/source/provider/destination changes another integration's credentials, authorization, health, retries, defaults, idempotency, or execution behavior;
- a replay produces a second Position Group/orchestration/destination delivery for the same canonical event;
- a successful destination is rolled back or automatically redispatched because a sibling failed;
- secret values appear in logs, health, API responses, or summaries;
- a DO/external MTProto source causes the Paid deployment to start/touch a Container runtime;
- the Free deployment requires a Container binding, Container migration, or Container recovery cron;
- TradingView direct ingress accepts traffic without the exact reviewed transport verification;
- TradingView caller-provided workspace/source/destination/execution fields become authority;
- a presented but unpinned client certificate is accepted;
- probe mode ever performs source lookup, body parsing, queueing, or accepts a TradingView request;
- `TRADINGVIEW_CERT_PROBE_ENABLED` remains enabled after the controlled observation window;
- a WAF `cert_verified` requirement or BYOCA/other Cloudflare Enterprise-only dependency becomes necessary for the TradingView trust boundary;
- any non-live acceptance path reaches a real broker executor.

## Gate outcome and next boundary

The source-code/CI and TradingView `0010` database-schema portions are complete and verified. The Cloudflare deployment contract now has two validated profiles: the existing Workers Paid config retains Containers as an explicit per-source MTProto option, while `wrangler.free.toml` is a separate no-Container baseline with isolated queues. CI dry-runs both. The transport code is Free-plan compatible by design: it pins the exact Cloudflare-observed SHA-256 fingerprint of a presented client certificate and does not require Enterprise BYOCA/Cloudflare CA verification. A temporary fail-closed certificate probe provides a controlled way to observe only presentation/fingerprint metadata while forcing HTTP 403 before source lookup or queueing. Direct TradingView **environment** acceptance is still not complete because this session cannot prove that a real TradingView webhook reaches the Worker with the required `request.cf.tlsClientAuth` presentation/fingerprint metadata on the actual non-Enterprise deployment. Keep direct ingress disabled until that proof exists.

The next safe engineering boundary is controlled account-side staging readiness: inspect the actual Cloudflare Worker/Queue bindings by names/status only, confirm the intended deployment profile, configure the dedicated hostname for Free-compatible certificate collection without `cert_verified` enforcement, deploy the probe-capable Worker, keep direct ingress disabled, temporarily enable the certificate probe, observe one real TradingView certificate fingerprint, disable the probe, and only then configure one non-execution TradingView source for acceptance. cTrader/MT5 demo probes/lifecycles stay behind their existing explicit demo gates. Real-money execution remains disabled until all non-live and demo acceptance is green and a separate deliberate live cutover decision is made.
