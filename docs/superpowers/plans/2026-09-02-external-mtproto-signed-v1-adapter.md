# External MTProto Signed-V1 Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a portable, first-class `external_mtproto` Telegram source adapter that a customer can run on any VM/VPS/container/Kubernetes host and connect to Mkety Trading through the existing signed `POST /api/v1/events` contract, while Mkety remains the authoritative tenant/source/chat policy boundary.

**Architecture:** Extend the existing authenticated Trading V1 ingress and `source_connections` registry rather than creating a parallel trading endpoint or external trading engine. The external Telethon process is transport-only: it may forward all visible Telegram events or pre-filter locally, but the authenticated Mkety source record always establishes workspace/account scope and server-side chat authorization. `source_connections.config` carries non-secret `chat_acceptance_mode` / `allowed_chat_ids`; external Telegram API/session credentials stay on the customer host; the existing encrypted source HMAC is the only Trading credential required by the adapter. Provider-independent Telegram identity remains `telegram:<accountScope>:<chatId>:<messageId>` so Container/DO/external replays collapse before interpretation/orchestration/destination work.

**Tech Stack:** Cloudflare Workers, JavaScript/Node, Python 3.12, Telethon, Supabase/PostgreSQL, existing AES-GCM source-secret storage, existing HMAC-SHA256 V1 ingress, Node test runner, Python unittest, GitHub Actions, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`

## Global Constraints

- Never merge `main` without explicit user instruction.
- Real-money execution remains disabled.
- TDD is mandatory: observe an exact failing test before production feature/bugfix code.
- Re-fetch and inspect the exact branch head before Task 1; do not overwrite newer work.
- Preserve the already-green Cloudflare Container MTProto runtime and its internal Queue handoff unless a focused parity test proves a change is necessary.
- External MTProto must use the existing `/api/v1/events` trust boundary; do not add a second trading pipeline.
- The authenticated source record, never caller body fields, establishes trusted workspace and Telegram account scope.
- VM `forward all` is a transport mode only. It must never imply server authorization `all_visible`.
- Server chat policy defaults to `allowlist`; an empty allowlist means accept no chats.
- `all_visible` must be an explicit server-side source setting.
- `source_connections.config` is non-secret configuration only. Do not store Telegram API hash/session or HMAC plaintext there.
- External Telegram API/session credentials remain on the customer's external host for this provider.
- The external host receives only its own Telegram credentials and its own source-specific Trading HMAC secret; never Supabase service role, `TRADING_MASTER_KEY`, Cloudflare internal transport token, AI credentials, broker credentials, or another tenant's secrets.
- Cross-provider Telegram identity remains `telegram:<accountScope>:<chatId>:<messageId>` and persistent uniqueness remains workspace-scoped.
- One source/workspace retry, auth failure, unauthorized chat, or outage must not affect another source/workspace.
- No secrets in logs, tests, commits, health output, exceptions, or chat.
- Update `AGENTS.md` after meaningful implementation/testing batches.
- Every meaningful head must pass Node core, MT5 bridge, MTProto Python tests (Container + external adapter), and Wrangler dry-run.

---

### Task 1: Server-Side External MTProto Chat and Account-Scope Authorization

**Files:**
- Create: `cloudflare-v2/src/sources/mtproto/external_policy.js`
- Modify: `cloudflare-v2/src/storage/supabase_ingest_store.js`
- Modify: `cloudflare-v2/src/pipeline/ingest.js`
- Create: `cloudflare-v2/tests/external_mtproto_ingest_policy.test.mjs`
- Modify: `cloudflare-v2/tests/supabase_ingest_store.test.mjs`

**Interfaces:**
- Produces: `authorizeExternalMtprotoEvent({ source, input })` returning an allow result or a fail-closed structured rejection.
- Consumes: authenticated source record, `source.config`, raw parsed event payload.
- `source_connections.config` fields:
  - `chat_acceptance_mode: "allowlist" | "all_visible"`
  - `allowed_chat_ids: string[]`
- Existing providers must remain unchanged when `provider_type !== "external_mtproto"`.

- [ ] **Step 1: Write failing policy tests**

Cover all of the following:

- authenticated `external_mtproto` + `allowlist` + listed native `chat_id` passes;
- default/missing mode behaves as `allowlist`;
- empty allowlist accepts no chats;
- unlisted chat returns a fail-closed authorization result before event reservation;
- explicit `all_visible` permits any native chat submitted by that authenticated source;
- VM/payload metadata saying it forwarded all does not enable `all_visible`;
- malformed/unknown acceptance mode fails closed;
- external provider requires `source_family=telegram` and server `external_identity`;
- native `chat_id` and `message_id` are required;
- caller-provided `workspace_hint` cannot override authenticated source workspace;
- optional payload `metadata.account_scope` must match server `external_identity` when supplied, otherwise reject;
- rejected external event runs zero event reservation, interpretation, AI, or orchestration work;
- a non-external provider still follows the existing ingest behavior unchanged.

- [ ] **Step 2: Extend Supabase ingest-store tests before production changes**

Require the authenticated source query to select and return non-secret `config` so the policy can be resolved after authentication. Assert no provider/session secret is added to the returned public record beyond the already server-only decrypted ingress secret.

- [ ] **Step 3: Run focused tests and observe RED**

Run:

```bash
cd cloudflare-v2
node --test tests/external_mtproto_ingest_policy.test.mjs tests/supabase_ingest_store.test.mjs
```

Expected: FAIL because `external_policy.js` does not exist and/or the ingest store does not expose source `config` to the authenticated server-side pipeline.

- [ ] **Step 4: Implement the minimal policy module**

Normalize `source.config.chat_acceptance_mode` to fail-closed `allowlist` by default. Normalize `allowed_chat_ids` to unique non-empty strings. Never infer `all_visible` from an empty/missing list. Return stable reason codes such as:

- `MTPROTO_CHAT_NOT_AUTHORIZED` (403)
- `MTPROTO_ACCOUNT_SCOPE_MISMATCH` (403)
- `MTPROTO_NATIVE_IDENTITY_REQUIRED` (400)
- `MTPROTO_SOURCE_POLICY_INVALID` (400/403 fail closed)

Do not inspect/decrypt Telegram session credentials; they do not belong in Mkety for `external_mtproto`.

- [ ] **Step 5: Wire policy into ingest after authentication and JSON parse, before normalization/reservation**

Required order:

```text
source lookup -> HMAC verification -> JSON parse -> trusted workspace/source binding
-> external MTProto server policy (only for external_mtproto)
-> normalize/canonical identity -> persistent reservation -> interpretation/AI -> orchestration
```

Authentication must remain before chat authorization/canonical reservation so an invalid source cannot suppress a legitimate event.

- [ ] **Step 6: Run focused GREEN plus existing identity/HTTP ingress suites**

Run:

```bash
cd cloudflare-v2
node --test \
  tests/external_mtproto_ingest_policy.test.mjs \
  tests/supabase_ingest_store.test.mjs \
  tests/v1_cross_provider_idempotency.test.mjs \
  tests/v1_events_http.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: authorize external mtproto chats server-side`

---

### Task 2: External Python Signed-V1 HTTPS Sink

**Files:**
- Create: `cloudflare-v2/external/mtproto-adapter/v1_sink.py`
- Create: `cloudflare-v2/external/mtproto-adapter/test_v1_sink.py`

**Interfaces:**
- Produces: `create_signed_v1_sink(endpoint, source_id, source_secret, transport=None, timeout=3.0, now_ms=None)`.
- Transport target: existing `POST /api/v1/events`.
- HMAC contract must exactly match JS `src/security/source_auth.js`:

```text
basis = "v1:<timestamp_ms>:<raw_json_body>"
signature = "v1=" + hex(HMAC-SHA256(source_secret, basis))
headers = X-Mkety-Source-Id, X-Mkety-Timestamp, X-Mkety-Signature
```

- [ ] **Step 1: Write failing sink tests**

Cover:

- compact/stable JSON body construction;
- exact HMAC parity against a known deterministic fixture;
- exact three source-auth headers;
- source secret never appears in body, exception, repr, or returned diagnostics;
- timestamp/signature may change per attempt while semantic event body remains byte-stable;
- HTTP 2xx `{ok:true, duplicate:false}` is terminal success;
- HTTP 2xx `{ok:true, duplicate:true}` is terminal success;
- network failure, 429, and 5xx classify as retryable;
- 400/401/403/404-style permanent source/policy errors classify as non-retryable;
- malformed success response fails safely without leaking response headers/secrets.

- [ ] **Step 2: Run RED**

```bash
cd cloudflare-v2
PYTHONPATH=external/mtproto-adapter \
python -m unittest external/mtproto-adapter/test_v1_sink.py -v
```

Expected: FAIL because `v1_sink.py` does not exist.

- [ ] **Step 3: Implement minimal sink using Python stdlib**

Use `json`, `hmac`, `hashlib`, `urllib`, and `asyncio.to_thread` (or an equivalent dependency-free transport boundary). Create explicit sanitized retryable/permanent exception types. Never log request signing material.

The sink must serialize the semantic event body once per delivery call; retries over that event reuse the same raw body and regenerate only freshness-sensitive timestamp/signature.

- [ ] **Step 4: Run GREEN**

```bash
cd cloudflare-v2
PYTHONPATH=external/mtproto-adapter \
python -m unittest external/mtproto-adapter/test_v1_sink.py -v
```

- [ ] **Step 5: Commit**

Commit message: `feat: add external mtproto signed v1 sink`

---

### Task 3: Portable External Telethon Adapter Runtime

**Files:**
- Create: `cloudflare-v2/external/mtproto-adapter/adapter.py`
- Create: `cloudflare-v2/external/mtproto-adapter/app.py`
- Create: `cloudflare-v2/external/mtproto-adapter/health.py`
- Create: `cloudflare-v2/external/mtproto-adapter/requirements.txt`
- Create: `cloudflare-v2/external/mtproto-adapter/test_adapter.py`
- Read-only parity reference unless a real mismatch is found: `cloudflare-v2/containers/mtproto-listener/listener.py`

**Interfaces / runtime config:**

Required names:

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION
TRADING_ENDPOINT
TRADING_SOURCE_ID
TRADING_SOURCE_SECRET
```

Optional:

```text
TELEGRAM_ACCOUNT_SCOPE   # local self-check only, never server authority
ALLOWED_CHAT_IDS         # local transport optimization only
```

Local behavior:

- no/empty `ALLOWED_CHAT_IDS` => forward all supported incoming events locally;
- non-empty `ALLOWED_CHAT_IDS` => local pre-filter;
- neither setting changes Mkety's server-side `chat_acceptance_mode`.

- [ ] **Step 1: Write failing adapter tests**

Using a fake Telethon client/event and fake V1 sink, cover:

- required configuration validation reports variable names only;
- Telegram session/API credentials are never echoed by health/errors;
- one session receives multiple chats;
- outgoing messages are ignored;
- absent local allowlist forwards events from different chats;
- configured local allowlist forwards only selected chats;
- local forward-all does not add any payload flag that could authorize server `all_visible`;
- native event payload preserves chat ID, message ID, text, occurrence time, thread/reply/edit metadata, and media-presence boolean;
- event external ID remains deterministic for the native Telegram message;
- receive callback enqueues without awaiting network delivery;
- bounded local queue isolates network work from Telegram receive loop;
- transient V1 sink failures retry only that event/source with capped delays;
- permanent sink rejection does not hot-loop and the worker continues with later events;
- duplicate terminal success is treated as successful delivery;
- sanitized health contains only status/connectivity/counters/timestamps/queue depth/reconnect information;
- stop/cancellation remains clean.

- [ ] **Step 2: Add explicit Container/external event-contract parity fixture**

Compare the external adapter's normalized Telegram event semantics against the already-tested Container listener contract for the same fake native event. Require parity for native identity, thread/reply/edit fields, media flag, text, and timestamps while allowing transport-specific wrapper fields to differ.

Do **not** refactor the proven Container listener just to share code. Only extract a pure shared Python event-builder later if the parity test exposes maintainability drift and packaging can remain simple without changing the Container Docker build context.

- [ ] **Step 3: Run RED**

```bash
cd cloudflare-v2
PYTHONPATH=external/mtproto-adapter \
python -m unittest discover -s external/mtproto-adapter -p 'test_*.py' -v
```

Expected: FAIL because external runtime modules do not exist.

- [ ] **Step 4: Implement the minimal external adapter**

Use Telethon with automatic reconnect, register handlers before `catch_up()`, use a bounded `asyncio.Queue`, and keep all retry/health state in the adapter process instance. The adapter must never perform signal interpretation, risk calculation, account safety, broker execution, or destination fan-out.

- [ ] **Step 5: Implement secret-free app bootstrap**

`app.py` loads configuration, builds Telethon client + signed V1 sink + adapter, and runs until disconnected/cancelled. Error output may name missing environment variables but never print values.

- [ ] **Step 6: Run external adapter GREEN and existing Container Python suite GREEN**

```bash
cd cloudflare-v2
PYTHONPATH=external/mtproto-adapter \
python -m unittest discover -s external/mtproto-adapter -p 'test_*.py' -v

PYTHONPATH=containers/mtproto-listener \
python -m unittest containers/mtproto-listener/test_listener.py -v
```

- [ ] **Step 7: Commit**

Commit message: `feat: add portable external mtproto adapter`

---

### Task 4: Cross-Provider Replay and Multi-Tenant Isolation Acceptance

**Files:**
- Create: `cloudflare-v2/tests/external_mtproto_replay_acceptance.test.mjs`
- Create: `cloudflare-v2/tests/external_mtproto_tenant_isolation.test.mjs`
- Reuse/read: `cloudflare-v2/tests/mtproto_recovery_replay_acceptance.test.mjs`
- Reuse/read: `cloudflare-v2/tests/v1_cross_provider_idempotency.test.mjs`

**Interfaces:**
- Exercises actual `ingestTradingEvent` source authentication, external policy, canonical event ID, and persistent reservation semantics.
- Does not introduce a new production endpoint.

- [ ] **Step 1: Add cross-provider replay acceptance before any acceptance-specific glue**

Prove both directions:

1. Container MTProto accepts native message `(scope, chat, message)`; external MTProto later submits the same native event using its independently authenticated source secret; external is a persistent duplicate and interpretation/orchestration/destination work stays exactly once.
2. External MTProto accepts first; Container later replays same native event; Container becomes the duplicate.
3. A different native Telegram `message_id` proceeds normally.
4. Invalid external authentication cannot reserve/suppress the canonical identity.
5. Direct external duplicate result is terminal success behavior compatible with the external sink contract.

- [ ] **Step 2: Add two-workspace isolation acceptance**

Use at least two workspaces with independent external sources and prove:

- separate source credentials;
- separate server chat policies;
- the same Telegram account/chat/message in workspace A and B remains two workspace-scoped events, not one cross-tenant event;
- source A secret cannot authenticate as source B;
- caller workspace override cannot move an event between tenants;
- source A's unauthorized chat is rejected without changing source B behavior;
- disabling/revoking/failing source A leaves source B operational;
- source-specific policy/config state is never read from another source.

- [ ] **Step 3: Run acceptance suites**

```bash
cd cloudflare-v2
node --test \
  tests/external_mtproto_replay_acceptance.test.mjs \
  tests/external_mtproto_tenant_isolation.test.mjs \
  tests/mtproto_recovery_replay_acceptance.test.mjs \
  tests/v1_cross_provider_idempotency.test.mjs
```

If the new tests fail, diagnose and add only the smallest missing production glue under TDD. If they pass without production changes, record that the existing authenticated/workspace-scoped idempotency architecture already satisfies that acceptance layer.

- [ ] **Step 4: Commit**

Commit message: `test: prove external mtproto replay and tenant isolation`

---

### Task 5: CI Gate and External Adapter Operating Documentation

**Files:**
- Create: `cloudflare-v2/tests/external_mtproto_ci_contract.test.mjs`
- Modify: `.github/workflows/trading-v1-ci.yml`
- Create: `cloudflare-v2/external/mtproto-adapter/README.md`
- Modify: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

**CI contract:**
- Keep the existing Container MTProto Python test invocation unchanged.
- Add the external adapter pure Python suite to the same mandatory MTProto gate/category, or as an immediately adjacent mandatory step in the same job.
- No external credentials are required for CI.

- [ ] **Step 1: Write a static RED CI-contract test**

Require the workflow to execute:

```bash
PYTHONPATH=external/mtproto-adapter \
python -m unittest discover -s external/mtproto-adapter -p 'test_*.py' -v
```

Also assert the existing Container listener test command remains present.

- [ ] **Step 2: Run RED**

```bash
cd cloudflare-v2
node --test tests/external_mtproto_ci_contract.test.mjs
```

Expected: FAIL because the workflow does not yet run external adapter tests.

- [ ] **Step 3: Update GitHub Actions without weakening existing gates**

Add external adapter Python tests while preserving:

1. Node Worker/trading-core;
2. pure MT5 bridge;
3. Container + external MTProto Python tests;
4. Wrangler dry-run.

- [ ] **Step 4: Write external adapter README/runbook**

Document configuration **names only**, never values. Cover:

- stable `POST /api/v1/events` integration;
- customer VM owns Telegram API/session credentials;
- source-specific Trading HMAC secret only;
- VM forward-all vs local `ALLOWED_CHAT_IDS` transport modes;
- independent Mkety server `allowlist` / explicit `all_visible` policy;
- default empty allowlist accepts no chats;
- changing Mkety signal channels requires no Telethon code change;
- source secret revocation/rotation is per-source;
- compromise blast radius is limited to that external source's credentials;
- duplicate replay is safe through persistent canonical idempotency;
- non-live test procedure and sanitized health expectations;
- no broker/live trading enablement is part of this adapter setup.

- [ ] **Step 5: Run focused CI-contract GREEN**

```bash
cd cloudflare-v2
node --test tests/external_mtproto_ci_contract.test.mjs
```

- [ ] **Step 6: Commit**

Commit message: `ci: gate external mtproto adapter tests`

---

### Task 6: Full Verification, Handoff, and Next Safe Boundary

**Files:**
- Modify: `AGENTS.md`
- No deployment/account-side mutation in this task.

- [ ] **Step 1: Run the complete local/pure verification matrix**

```bash
cd cloudflare-v2
npm run test:ci

PYTHONPATH=bridges \
python -m unittest bridges/test_mt5_bridge.py -v

PYTHONPATH=containers/mtproto-listener \
python -m unittest containers/mtproto-listener/test_listener.py -v

PYTHONPATH=external/mtproto-adapter \
python -m unittest discover -s external/mtproto-adapter -p 'test_*.py' -v

npx wrangler deploy --dry-run
```

Expected: all PASS.

- [ ] **Step 2: Inspect exact newest GitHub Actions run at the exact branch head**

Do not call the branch green based on an older run. Require success for Node core, MT5 bridge, Container/external MTProto tests, and Wrangler dry-run.

- [ ] **Step 3: Update `AGENTS.md` with verified handoff evidence**

Record:

- external adapter trust boundary;
- server-side `chat_acceptance_mode` / `allowed_chat_ids` semantics;
- forward-all is transport-only;
- source-specific credential blast radius;
- exact RED/GREEN CI evidence;
- no new DB migration/table for this slice;
- external Telegram API/session credentials are not stored in Mkety;
- exact next safe starting point.

Recommended next safe point after this plan is GREEN: a **non-live external VM soak/integration acceptance** using a Telegram test account/channel and a non-live `external_mtproto` source, or—if account-side credentials/runtime are not available—continue the broader multi-source plan with TradingView/custom/MT5/cTrader source adapters. Do not block unrelated source implementation on external VM availability.

- [ ] **Step 4: Commit handoff update**

Commit message: `docs: record external mtproto adapter acceptance`

- [ ] **Step 5: Verify the documentation head also has a fresh GREEN CI run before final completion claim**

- [ ] **Step 6: Stop before deployment/merge/live execution**

Do not:

- apply unrelated migrations;
- deploy to a real customer's external VM without their runtime configuration;
- enable meaningful-capital/live broker execution;
- merge `main`.

Those require their own controlled acceptance step and explicit user instruction where applicable.

## Plan Self-Review Checklist

Before execution, confirm:

- [ ] no `TBD`/`TODO`/placeholder requirements remain;
- [ ] VM `forward all` and server `all_visible` are explicitly separate concepts;
- [ ] server default is `allowlist`, empty list = deny all;
- [ ] no new DB table/migration is required for chat policy because existing tenant-scoped `source_connections.config` is sufficient;
- [ ] external Telegram API/session remains external and is not added to Mkety storage;
- [ ] only the source-specific ingress HMAC crosses from Mkety to the external adapter;
- [ ] all production changes have a preceding RED;
- [ ] acceptance tests prove same-channel/same-account cross-workspace isolation;
- [ ] Container listener is not refactored merely for code-sharing aesthetics;
- [ ] all unit/CI tests are credential-free and non-live;
- [ ] real-money execution and `main` merge remain out of scope.
