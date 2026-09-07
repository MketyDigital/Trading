# Mkety Trading — Production Audit, Progress and Completion Checkpoint

**Original checkpoint date:** 2026-09-05  
**Completion update:** 2026-09-06  
**Repository:** `MketyDigital/Trading`  
**Active completion branch:** `design/enterprise-trading-event-core-completion`  
**Preserved staging feature branch:** `design/enterprise-trading-event-core`  
**Draft PR:** #3 -> `design/enterprise-trading-event-core`  
**Current classification:** `GREEN / STAGING ACCEPTANCE PENDING`

Read this with repository-root `AGENTS.md` and `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`.

## 1. Approved authority model

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Trading is an independent runtime/data plane inside Mkety. `trade.mkety.com` is canonical. Optional customer hostnames are routing context only and never authorization.

Admin authorization remains layered:
1. canonical/custom hostname routing boundary;
2. exact selected Trading workspace;
3. trusted Mkety-signed Trading assertion bound to that workspace;
4. exact persisted Trading workspace entitlement;
5. exact enabled Trading membership in Supabase;
6. route-specific permission.

Production execution authority is independently reloaded from persisted state before broker dispatch. Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never execution authority.

## 2. Fresh executable verification

The current runtime code was freshly verified at:

- SHA: `20f46dce609cfb0d368557035c2fe33b019a5865`
- Trading V1 CI run: `34031424441` (#1585)
- mandatory test job: `101481528392` — **success**
- Worker/trading-core Node tests — **success**
- pure MT5 bridge tests — **success**
- pure MTProto Python tests — **success**

The preceding RED was a stale test-contract failure in `v1_admin_sources.test.mjs`: source activation now intentionally reloads the persisted source before enablement to verify credentials/transport readiness, but the old fixture expected the enable mutation to be the next store call. The readiness guard was preserved; the test was corrected to require the `getSource` readiness lookup before `setSourceEnabled`.

Repository classification is therefore:

**GREEN / STAGING ACCEPTANCE PENDING.**

Subsequent documentation-only commits do not alter the verified runtime code.

## 3. Source ingestion and duplicate recovery audit

Verified invariants:
- source HMAC/authentication is completed before caller payload is accepted;
- workspace and source identity are overwritten from the authenticated server-owned source registry;
- external MTProto policy is server-owned and runs before normalization/reservation;
- duplicate replay bodies cannot replace persisted canonical event content;
- duplicate recovery reconstructs the event from persisted DB truth + currently authenticated source/workspace;
- only reusable terminal interpretation states are reused (`READY`, `MANAGEMENT`, `NO_ACTION`, `NEEDS_REVIEW`);
- incomplete states such as `RECEIVED` are reinterpreted;
- duplicate re-orchestration requires `recoveryReady=true`.

No caller-controlled workspace authority was found in the reviewed ingest/recovery path.

## 4. Execution authority, broker ownership and risk audit

Immediately before broker action, the runtime reloads and validates:
- exact persisted trading event and workspace;
- exact persisted source and active state;
- exact Trading workspace entitlement;
- exact persisted trade account and workspace relationship;
- account active state;
- account `execution_enabled` state.

The coordinator then enforces:
- Worker-wide `BROKER_EXECUTION_ENABLED` master fuse before broker-capable work;
- account safety policy and kill switch;
- current broker/risk materialization where required;
- server-owned/decrypted broker credentials from persisted account state;
- broker-authoritative MT5 account/server/symbol/price checks;
- cTrader demo/live environment separation and the additional `CTRADER_LIVE_TRADING_ENABLED` gate for live cTrader;
- no unsupported broker platform fallthrough.

New broker accounts are created inactive, execution-disabled and with kill switch enabled. Deactivation clears `execution_enabled` so stale authority cannot silently return after reactivation.

## 5. Idempotency, retry and recovery audit

Database/runtime protections reviewed:
- trading events are unique by workspace + source connection + external event identity;
- destination deliveries are unique by workspace + idempotency key;
- delivery reserve treats unique-conflict as duplicate and reads the existing durable result;
- retry claims use compare-and-set fields (`status`, attempt count, due/lease timestamp);
- live leases are not stealable;
- an ordinary first-attempt `PENDING` row without a lease is not automatically replayed because its broker outcome may be unknown;
- expired leased `PENDING` work can be recovered without consuming another logical attempt;
- durable broker outcomes remain authoritative;
- state-binding repair remains separate from broker resend/retry.

No idempotency weakening was found in the reviewed completion path.

## 6. Mkety access / Supabase revocation audit

Admin authorization verifies the selected workspace in the signed Mkety assertion before reading the caller-selected workspace row. The verifier contract remains RS256 + issuer + audience + time validity + subject + `product=trading` + exact workspace + `access=owner`.

After assertion verification, Trading still requires:
- exact persisted workspace row;
- `trading_access_enabled=true`;
- exact enabled membership matching workspace and subject;
- route permission.

Supabase therefore remains final application entitlement/revocation authority. No direct-Zitadel fallback or Trading-only signer was introduced.

## 7. Hostname and admin lifecycle audit

- canonical hostname enforcement always runs;
- with custom hostnames disabled, non-canonical hosts fail closed;
- with custom hostnames enabled, only an exact active persisted mapping is accepted;
- custom hostname workspace must match the selected/signed workspace;
- hostname is routing context, never authorization;
- source/admin account stores are exact-workspace scoped;
- source list responses strip secret-like fields;
- source activation requires persisted-source readiness;
- account credentials are validated and encrypted before persistence and are not returned publicly.

## 8. Legacy execution-surface audit

The V1 entrypoint retires the legacy broker-capable public signal route before legacy execution code is reached:
- `/api/webhook/process_signal` -> HTTP 410;
- legacy `/api/admin/*` routes -> HTTP 410 before the old unscoped admin implementation.

Supported V1 event/admin/internal/webhook paths remain behind their corresponding access/authentication boundaries.

## 9. Rollout safety configuration

Current `wrangler.toml` remains fail-closed:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

The Paid staging workflow independently greps the first four critical gates as false before deployment and runs a final Wrangler dry run. Gate 2 acceptance uses ephemeral generated secrets and simulation, keeps Trading access and broker execution disabled, verifies no new Container instances, and rolls back to the configured known-good staging version.

Required configuration before external admin rollout:
- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

Required configuration before customer custom-host rollout:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

Real broker/provider credentials remain external deployment secrets and must not be committed.

## 10. Historical verified baselines

Useful prior GREEN milestones:
- source onboarding `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d` — run `33992264387`, job `101376473506`;
- documentation `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` — run `33992567673`, job `101377281313`;
- broker onboarding `d852de184c0b156dc360c4d242569b756acc2225` — run `33964408888`, job `101301829090`;
- Trading Supabase previously verified through migration 0014.

## 11. External state before controlled staging rollout

Before the current rollout sequence:
- Worker: `mkety-copier-engine`;
- last recorded Paid staging version: `68998f7f-74ce-4c37-8887-3751d3e17489`;
- completion runtime not yet promoted to production;
- no customer DNS/custom-host mutation in repository completion;
- no real broker/provider credentials connected;
- no real broker orders placed;
- no merge to `main`.

## 12. Exact next pickup

1. Advance only the reviewed staging feature branch as necessary; keep `main` untouched.
2. Run the existing fail-closed Paid staging deploy/acceptance gate with ephemeral/non-real acceptance secrets and `BROKER_EXECUTION_ENABLED=false`.
3. Verify rollback and absence of unintended Container/broker side effects.
4. Run remaining non-real Mkety access / TradingView / provider-readiness acceptance required for launch.
5. Record exact deployment/acceptance evidence in this document and the fast-path handoff.
6. Production promotion remains blocked until required staging acceptance/configuration checks pass.
7. Real-money execution remains disabled unless separately approved with exact financial limits.