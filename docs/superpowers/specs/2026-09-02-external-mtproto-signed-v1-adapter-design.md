# External MTProto Signed-V1 Adapter Design

Date: 2026-09-02
Branch: `design/enterprise-trading-event-core`
Status: Approved in chat; written spec pending final user review

## Purpose

Add a first-class `external_mtproto` source mode so a customer can run a Telegram MTProto userbot/listener (recommended implementation: Telethon) on any VM/VPS/container/Kubernetes host they control and connect it to Mkety Trading through the existing versioned Trading V1 ingestion boundary.

The external runtime is a **source adapter only**. It must not become a second trading engine and must not own broker execution, risk, account safety, tenant authority, AI policy, or destination state.

## High-level flow

```text
Telegram account
  -> external Telethon MTProto listener
  -> optional local chat filtering
  -> signed HTTPS POST to Mkety Trading V1
  -> source authentication
  -> exact workspace/source resolution
  -> server-side chat authorization
  -> provider-independent canonical Telegram identity
  -> persistent idempotency
  -> deterministic/AI interpretation
  -> correlation + risk + account safety
  -> destination fan-out / broker adapters
```

The recommended endpoint remains the existing versioned source-ingress contract (`POST /api/v1/events`) unless implementation review identifies a compatibility reason to introduce a thin alias that still terminates in exactly the same V1 ingestion code path.

## Core principles

1. **Mkety remains authoritative.** The external listener may locally filter chats, but server-side workspace/source/chat authorization is always the final authority.
2. **No code changes when signal channels change.** A customer can add/remove allowed Telegram chats in Mkety configuration without redeploying the external listener.
3. **No code changes when another customer connects.** A new external MTProto customer creates another isolated `external_mtproto` source connection; the same fixed ingestion contract handles it.
4. **Adapter-side filtering is optional optimization only.** Customers may forward every Telegram event visible to the userbot or only selected chats.
5. **Forwarding is not authorization.** A VM configured to forward all visible events does not implicitly grant Mkety permission to process all visible chats. Mkety's independent server-side chat policy still decides what is accepted.
6. **The external adapter holds only its own secrets.** It must never receive Trading master secrets, Supabase service-role credentials, broker credentials, AI credentials, Cloudflare internal transport tokens, or another source's credentials.
7. **Provider failover/redundancy does not change native identity.** Container MTProto, DO MTProto, and external MTProto events for the same Telegram account/chat/message converge on one canonical event identity.
8. **Duplicate success is terminal success.** A replay that resolves to an existing canonical event must not trigger interpretation, orchestration, or destination work again.
9. **Failure isolation is mandatory.** One external adapter/source/workspace/network failure or retry loop cannot block, restart, reorder, mutate, or poison another source or tenant.
10. **External runtime is presentation/transport only.** It never decides whether a message is tradable beyond optional local chat filtering; Mkety performs interpretation, correlation, risk, and execution safety.

## Two supported external forwarding modes

These are **transport choices on the external VM only**. They are separate from Mkety's server-side authorization mode described later.

### Mode A — Forward all visible Telegram events

The external Telethon listener subscribes broadly and sends all supported incoming Telegram events it can see to Mkety.

This does **not** mean Mkety accepts all of those chats. For example, the VM may forward every event while the Mkety source remains in the default `allowlist` authorization mode; Mkety will reject every chat that is not in that source's server-side allowlist.

Mkety then:

1. authenticates the submitted `source_id`;
2. resolves that exact source's workspace and provider definition server-side;
3. verifies the Telegram account scope associated with that source;
4. applies that source's server-side `chat_acceptance_mode`;
5. when in `allowlist`, verifies the submitted native `chat_id` is authorized for that exact source;
6. rejects/ignores unauthorized chats before interpretation or trading;
7. derives canonical Telegram identity and proceeds through persistent idempotency.

This transport mode lets customers change signal channels entirely from Mkety without touching their VM deployment.

### Mode B — Pre-filter locally

The customer optionally configures local allowed chat IDs, for example through environment/configuration:

```text
ALLOWED_CHAT_IDS=-100123456789,-100987654321
```

The external Telethon process sends only those chats.

This local filter reduces outbound traffic but is **never trusted as the security boundary**. Mkety repeats the same server-side authorization as Mode A.

The owner does not need to duplicate source-channel configuration in both places. Local filtering is optional; Mkety configuration is authoritative.

## SaaS tenancy and identity model

Each external source belongs to one exact `(workspace_id, source_connection_id)` and has its own authentication secret.

A request authenticated as Source A cannot become Source B's event, even when:

- both sources listen to the same Telegram channel;
- both sources use the same Telegram account;
- both sources submit an identical message body;
- the caller submits another workspace ID in the request body;
- the caller changes optional metadata.

The authenticated source connection establishes trusted workspace authority. Caller-supplied workspace fields are ignored or validated against that authority, never accepted as the authority themselves.

### Canonical Telegram identity

All Telegram MTProto providers must converge on:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Where:

- `accountScope` is the server-authoritative Telegram account identity/scope registered for the source;
- `chatId` comes from the native Telegram event and must pass server-side source authorization;
- `messageId` comes from the native Telegram event.

Provider runtime IDs, VM hostnames, webhook request IDs, and retry attempt numbers are never part of the canonical identity.

Canonical-event uniqueness remains workspace-scoped in Trading persistence, so two different customer workspaces observing the same Telegram account/chat/message do not merge into one tenant's event.

## External adapter configuration contract

A minimal external runtime should require configuration equivalent to:

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION
TRADING_ENDPOINT
TRADING_SOURCE_ID
TRADING_SOURCE_SECRET
TELEGRAM_ACCOUNT_SCOPE   # optional local self-check; server remains authoritative
ALLOWED_CHAT_IDS         # optional transport optimization
```

Exact variable names may change during implementation, but the trust model may not.

The adapter must not require:

```text
SUPABASE_SERVICE_ROLE
TRADING_MASTER_KEY
INTERNAL_SOURCE_TRANSPORT_TOKEN
BROKER_CREDENTIALS
AI_PROVIDER_CREDENTIALS
OTHER_TENANT_SECRETS
```

## Signed V1 transport contract

The external adapter sends the universal Trading V1 event body over HTTPS and authenticates it with the source-specific HMAC contract already used by V1 source authentication.

The payload must include sufficient native Telegram data to derive and verify identity, including at minimum:

- source identity through authentication headers / `source_id` contract;
- native Telegram `chat_id`;
- native Telegram `message_id`;
- message text;
- occurrence timestamp when available;
- thread/reply/edit metadata when available;
- media-presence metadata when relevant.

The external adapter must not manufacture a workspace authority field.

### Retry semantics

The semantic event body/native identity is immutable across retries.

For the same Telegram message, retries preserve the same account scope, chat ID, message ID, text, thread metadata, and event semantics. Authentication timestamp/signature may be regenerated if freshness windows require it, but this cannot alter canonical event identity.

Terminal success conditions:

- first accepted event;
- persistent duplicate result for an already-reserved canonical event.

Retryable failures include bounded network failures and retryable HTTP/server failures such as transient 5xx or explicitly retryable rate-limit responses.

Non-retryable/fail-closed conditions include invalid credentials/signature, unknown or inactive source, tenant/source mismatch, unauthorized chat, malformed native identity, or permanently invalid payload.

Retry state belongs only to that external source/runtime. It cannot create a global retry latch or suspend another source.

## Server-side chat authorization

Mkety must maintain the authorization policy for Telegram chats in server-side source configuration. This policy is independent of whether the external VM forwards all chats or pre-filters locally.

The exact storage shape can reuse the source connection configuration model so long as:

- chat authorization is resolved only after source authentication;
- lookup is constrained to the exact authenticated source/workspace;
- changing allowed chats does not require adapter code or Mkety deployment changes;
- one source cannot authorize another source's chats through shared mutable state;
- an empty configured allowed-chat set has an explicit fail-closed meaning for `external_mtproto` rather than silently meaning “all chats”, unless the customer explicitly enables an “accept all visible chats” policy.

### Recommended authorization policy field

Use an explicit server-side mode rather than inferring policy from an empty list:

```text
chat_acceptance_mode = "allowlist" | "all_visible"
allowed_chat_ids = [...]
```

Default must be `allowlist`.

In `allowlist` mode, an empty `allowed_chat_ids` means **accept no chats**.

`all_visible` is an explicit customer authorization choice. It means all Telegram chats submitted by that authenticated external source may enter interpretation, but they are still isolated to that source/workspace and still pass all later idempotency/interpretation/risk controls.

`all_visible` is not inferred from the external adapter forwarding everything. The two settings are deliberately independent.

This distinction prevents accidental trading from unrelated chats because someone forgot to configure an allowlist.

## Shared listener core vs external deployment package

Recommended implementation reuses the already-tested pure Telegram event normalization behavior from the Container/Telethon listener wherever practical, but keeps deployment/security concerns separate.

### Shared behavior

- outgoing-message suppression;
- native Telegram ID extraction;
- thread/reply/edit metadata;
- media-presence metadata;
- deterministic event construction;
- secret-free health counters;
- retry/cancellation behavior where transport semantics overlap.

### External-specific behavior

- direct signed-V1 HTTPS sink instead of Cloudflare internal Queue handoff;
- source-specific HMAC secret available only in that external runtime;
- optional local chat allowlist;
- external process health/readiness;
- no Cloudflare internal transport token;
- no Durable Object lifecycle dependency.

Implementation should avoid copy-pasting listener logic into two diverging codebases when a small pure shared module can express the common Telegram event contract.

## Security boundaries

### External host compromise

Compromise of one customer external listener may expose only that listener's Telegram session/API credentials and that source's own Trading source secret.

It must not provide access to:

- another workspace;
- another source secret;
- Trading master encryption key;
- Supabase service role;
- Cloudflare internal source token;
- AI secrets;
- broker/destination credentials.

The source secret should be independently revocable/rotatable without rotating other sources.

### Replay and duplicate attacks

A validly authenticated replay of an already accepted native Telegram event must collapse through persistent canonical idempotency before interpretation/orchestration/destination execution.

A forged/invalid source must never reserve canonical identity before authentication and therefore cannot suppress the legitimate event.

### Chat injection

A valid source credential submitting an unapproved chat ID must fail closed before interpretation or destination work when the source is in `allowlist` mode.

### Account-scope mismatch

The external payload must not be able to change the server-authoritative Telegram account scope. The canonical account scope comes from the authenticated source connection; any caller-provided scope is advisory/self-checking only and must match if validated.

## Health and observability

External adapter health may expose only operational values such as:

- `status`;
- Telegram connected/authenticated boolean;
- last Telegram event timestamp;
- delivery successes/failures;
- last successful delivery timestamp;
- last delivery error timestamp/code;
- local queue depth;
- restart/reconnect count.

Health/logs must never expose:

- Telegram API hash;
- Telegram session string;
- source HMAC secret;
- Authorization/signature headers;
- decrypted provider credentials;
- request bodies containing secrets.

Mkety source status should remain per-source. Aggregate workspace health is derived/read-only and cannot become shared mutable execution state.

## Failure isolation

The external adapter path inherits the platform-wide isolation contract.

Specifically:

1. One external source's network outage cannot block another source's ingestion.
2. One external source's bad HMAC cannot degrade another source's health.
3. One workspace's unauthorized chat attempts cannot alter another workspace's allowlists or rate limits.
4. One source retry backlog cannot reorder or block another source.
5. One source being disabled/revoked cannot stop unrelated providers.
6. Container and external MTProto providers may coexist; neither is a startup dependency for the other.
7. A global control may affect multiple tenants only when it is an intentional platform-wide safety control.

## Data model implications

Existing `source_connections` remains the source registry.

No new table is required solely because the listener is external if existing source fields can safely represent:

- `provider_type = external_mtproto`;
- Telegram account/external identity;
- active/default state;
- encrypted source-ingress HMAC secret;
- non-secret chat authorization config.

If the current source config needs stronger explicitness, add only additive Trading-owned fields/migration for `chat_acceptance_mode` or equivalent. Do not alter unrelated Mkety schema.

External Telegram API/session credentials are normally owned by the customer's external host and therefore do **not** need to be stored in Mkety for the external provider.

## Admin / UX behavior

Future source-admin UI/API should let a workspace owner:

1. create an External Telegram / MTProto source;
2. receive/configure its source ID and source-specific signing credential through a secure workflow;
3. choose `allowlist` or explicit `all_visible` chat acceptance;
4. add/remove allowed Telegram chat IDs in Mkety;
5. rotate/revoke the source credential independently;
6. enable/disable the source without affecting other sources;
7. see sanitized source health/status;
8. optionally view sample integration instructions for Telethon without requiring custom Mkety code.

Changing allowed signal channels must not require changing the owner's Telethon code or deploying Mkety.

## Testing requirements

### Unit / contract tests

- external signed-V1 request authenticates with that source's HMAC;
- wrong source secret fails before persistent event reservation;
- authenticated source establishes trusted workspace;
- caller workspace/account-scope overrides are ignored or rejected;
- allowlisted chat passes;
- unlisted chat fails closed;
- empty allowlist accepts no chats;
- `all_visible` only works when explicitly configured server-side;
- VM forward-all does not imply server-side `all_visible`;
- local adapter filtering is optional and never required for server authorization;
- semantic event identity is stable across retries;
- duplicate V1 result is terminal success;
- transient failures retry within bounded source-local policy;
- permanent auth/validation failures do not hot-loop;
- health/logging does not expose secrets.

### Multi-provider replay acceptance

Prove that:

1. Container MTProto accepts `telegram:<scope>:<chat>:<message>`;
2. external MTProto later sends the exact same native Telegram event;
3. V1 authenticates the external source independently;
4. both resolve to the same canonical Telegram identity;
5. the external event is a persistent duplicate;
6. interpretation/orchestration/destination work remains exactly once;
7. Queue/direct transport both treat duplicate as terminal success;
8. a new Telegram message ID proceeds normally.

### Multi-tenant isolation acceptance

Inject concurrent traffic from at least two workspaces and prove:

- separate source credentials;
- separate allowed-chat policies;
- same Telegram channel does not merge tenants;
- source A cannot submit as source B;
- one source retry/failure does not block the sibling source;
- disabling/revoking one source leaves the other operational.

## CI / acceptance gates

All existing CI gates remain mandatory:

1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. MTProto Python/container tests;
4. Wrangler dry-run.

Add external MTProto pure tests to the existing MTProto/Python gate or a separate equally mandatory gate if packaging makes that clearer.

No real-money execution is introduced by this source adapter work.

## Delivery sequence

1. Add RED tests for server-side external-MTProto chat authorization and trusted account-scope behavior.
2. Add/extend source configuration model for explicit `allowlist` vs `all_visible` semantics if not already expressible safely.
3. Add external signed-V1 sink with retry classification and duplicate-terminal-success behavior.
4. Add external Telethon entrypoint/package using shared native Telegram event normalization.
5. Add secret-free health/readiness.
6. Add cross-provider replay acceptance (Container -> external and external -> Container).
7. Add two-workspace/source/chat failure-isolation acceptance.
8. Update source-admin/runbook documentation.
9. Run all CI gates.
10. Only after static acceptance, perform non-live external VM integration/soak with a Telegram test account/channel.

## Non-goals for this slice

- broker execution changes;
- real-money enablement;
- moving Supabase/master/broker credentials to external hosts;
- forcing all customers to use external MTProto;
- replacing Cloudflare Container MTProto;
- requiring customers to maintain channel IDs in two places;
- automatically accepting all Telegram chats because an allowlist is empty;
- building a generic all-protocol external agent SDK before this adapter is proven.

## Acceptance criteria

This design is complete when a customer can keep one stable Telethon integration pointed at Mkety, choose either forward-all or locally prefiltered delivery, change signal-source chats from Mkety without code changes, and have the SaaS independently authenticate, tenant-scope, chat-authorize, deduplicate, interpret, and route each event with no cross-user/source/provider mix-up.
