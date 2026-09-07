# Enterprise Self-Service Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authorized Trading workspace owner create and update Telegram/MTProto source connections and MT5/cTrader broker accounts with encrypted credentials, without GitHub-secret edits or developer intervention.

**Architecture:** Reuse `src/security/secret_box.js` for AES-GCM encryption and wrap it with a typed versioned JSON credential envelope. Extend the existing admin source/account surfaces with workspace-scoped create and credential-replacement operations. Add one Trading-only database column for broker credential ciphertext; source credential ciphertext already exists.

**Tech Stack:** Cloudflare Workers JavaScript, Web Crypto AES-GCM, Supabase/Postgres, Node test runner, GitHub Actions CI.

**Spec:** `docs/superpowers/specs/2026-09-05-enterprise-self-service-connections-design.md`

## Global Constraints

- Work only on `design/enterprise-trading-event-core`.
- Never persist plaintext provider/broker secrets in JSON configuration, logs, API responses, or audit payloads.
- Reuse `TRADING_MASTER_KEY` and `src/security/secret_box.js`; do not add a second encryption system.
- Source secrets use `source_connections.provider_secret_ciphertext`.
- Broker secrets use new `trade_accounts.credential_ciphertext`.
- Browser/admin responses expose only safe metadata plus `credentialsConfigured`.
- `BROKER_EXECUTION_ENABLED` remains false and authoritative during this feature.
- New broker accounts must always start with `execution_enabled=false`.
- Do not merge Trading runtime to `main`.
- Do not connect real external accounts or authorize real-money execution in this plan.

---

### Task 1: Typed credential envelope

**Files:**
- Create: `cloudflare-v2/src/security/connection_credentials.js`
- Create: `cloudflare-v2/tests/connection_credentials.test.mjs`

**Interfaces:**
- Consumes: `encryptSecret(secret, masterKey)` and `decryptSecret(encryptedSecret, masterKey)` from `src/security/secret_box.js`.
- Produces:
  - `encryptConnectionCredentials(kind, credentials, masterKey): Promise<string>`
  - `decryptConnectionCredentials(expectedKind, ciphertext, masterKey): Promise<object>`
  - `validateConnectionCredentials(kind, credentials): object`

- [ ] **Step 1: Write failing tests**

Cover:
- MTProto `{apiId, apiHash, session}` round-trip.
- MT5 `{bridgeUrl, bridgeSecret}` round-trip.
- cTrader `{clientId, clientSecret, accessToken, refreshToken}` round-trip.
- empty credential object rejected.
- unknown credential key rejected.
- wrong expected kind rejected after decrypt.
- malformed version rejected.

Expected validation shape:

```js
assert.deepEqual(validateConnectionCredentials('mt5', {
  bridgeUrl: 'https://bridge.example',
  bridgeSecret: 'secret',
}), {
  bridgeUrl: 'https://bridge.example',
  bridgeSecret: 'secret',
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/connection_credentials.test.mjs`

Expected: FAIL because `src/security/connection_credentials.js` does not exist.

- [ ] **Step 3: Implement minimal credential envelope**

Use allowlists:

```js
const ALLOWED = {
  mtproto: ['apiId', 'apiHash', 'session'],
  mt5: ['bridgeUrl', 'bridgeSecret'],
  ctrader: ['clientId', 'clientSecret', 'accessToken', 'refreshToken'],
};
```

Serialize before encryption:

```js
JSON.stringify({ version: 1, kind, data: normalizedCredentials })
```

Reject unknown keys, blank values, unsupported kinds, wrong version, wrong kind, non-object payloads.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/connection_credentials.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add typed connection credential envelopes`

---

### Task 2: Broker credential persistence migration

**Files:**
- Create: `cloudflare-v2/db/migrations/0014_trading_connection_credentials.sql`
- Create: `cloudflare-v2/tests/trading_connection_credentials_migration.test.mjs`

**Interfaces:**
- Produces nullable `public.trade_accounts.credential_ciphertext TEXT`.

- [ ] **Step 1: Write failing migration-contract test**

Assert migration text contains:

```sql
ALTER TABLE public.trade_accounts
    ADD COLUMN IF NOT EXISTS credential_ciphertext TEXT;
```

and a comment declaring server-side decrypt only / never expose.

Assert it does not grant anon/authenticated privileges and does not modify shared Mkety tables.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/trading_connection_credentials_migration.test.mjs`

Expected: FAIL because migration file does not exist.

- [ ] **Step 3: Add minimal migration**

Use one transaction and only alter `public.trade_accounts`.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `node --test tests/trading_connection_credentials_migration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `db: add broker credential envelope storage`

---

### Task 3: Self-service source creation and credential replacement

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_sources.js`
- Modify if needed: `cloudflare-v2/src/sources/provider_config_validation.js`
- Create: `cloudflare-v2/tests/v1_admin_source_connections.test.mjs`

**Interfaces:**
- Consumes: `encryptConnectionCredentials('mtproto', credentials, masterKey)`.
- Adds store operations:
  - `createSource(workspaceId, input, credentialCiphertext)`
  - `replaceSourceCredentials(workspaceId, sourceId, credentialCiphertext)`
- HTTP:
  - `POST /api/v1/admin/sources`
  - `PUT /api/v1/admin/sources/:id/credentials`

- [ ] **Step 1: Write failing route/store tests**

Cover:
- `POST` requires `sources.write`.
- workspace ID comes from authorization, not body.
- provider/source-family mismatch rejects.
- MTProto credentials are encrypted before persistence.
- persisted `config` contains no `apiHash`, `session`, token, secret, or ciphertext.
- returned source contains `credentialsConfigured: true` and no credential/envelope field.
- create defaults `is_active=false` unless explicit safe enable is supported by existing provider semantics; prefer false.
- duplicate/DB failure returns stable `SOURCE_CREATE_FAILED`.
- `PUT /:id/credentials` is workspace-scoped and returns safe metadata only.
- unsupported credential keys return `SOURCE_CREDENTIALS_INVALID`.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/v1_admin_source_connections.test.mjs`

Expected: FAIL because POST/create and credentials PUT are not implemented.

- [ ] **Step 3: Implement minimal source onboarding**

Extend `SOURCE_SELECT` to include `provider_secret_ciphertext` only internally. Ensure `publicSource()` strips it and computes:

```js
credentialsConfigured: Boolean(source.providerSecretCiphertext)
```

Accept safe non-secret body fields only. For MTProto, validate and encrypt credentials with `env.TRADING_MASTER_KEY` before calling store insert/update.

Never accept `workspace_id`, `provider_secret_ciphertext`, `secret_ciphertext`, or credential material inside `config`.

- [ ] **Step 4: Run focused source tests and existing admin source tests**

Run:
- `node --test tests/v1_admin_source_connections.test.mjs`
- existing source/admin tests selected by filename match if present.

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add workspace source onboarding`

---

### Task 4: Self-service broker account creation and credential replacement

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_accounts.js`
- Create: `cloudflare-v2/tests/v1_admin_account_connections.test.mjs`

**Interfaces:**
- Consumes: `encryptConnectionCredentials(platform, credentials, masterKey)` where platform maps `mt5 -> mt5`, `ctrader -> ctrader`.
- Adds store operations:
  - `createAccount(workspaceId, input, credentialCiphertext)`
  - `replaceAccountCredentials(workspaceId, accountId, credentialCiphertext)`
- HTTP:
  - `POST /api/v1/admin/accounts`
  - `PUT /api/v1/admin/accounts/:id/credentials`

- [ ] **Step 1: Write failing route/store tests**

Cover:
- only `mt5` and `ctrader` accepted.
- account ID/label required; MT5 requires server name.
- credentials encrypted before persistence.
- `execution_enabled=false` forced at creation even if request sends true.
- workspace ID comes only from authorization.
- safe risk fields accepted only from existing enum/policy domain.
- response contains `credentialsConfigured: true`, no ciphertext/token/password/secret.
- replacement is workspace scoped.
- unsupported credential keys return `ACCOUNT_CREDENTIALS_INVALID`.
- DB failure returns `ACCOUNT_CREATE_FAILED`.
- global `BROKER_EXECUTION_ENABLED` reporting remains unchanged.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test tests/v1_admin_account_connections.test.mjs`

Expected: FAIL because create/credentials routes do not exist.

- [ ] **Step 3: Implement minimal account onboarding**

Extend `ACCOUNT_SELECT` with `credential_ciphertext` internally and compute:

```js
credentialsConfigured: Boolean(account.credential_ciphertext)
```

Insert safe fields with forced `execution_enabled: false`. Do not accept credential ciphertext or workspace ID from request body.

- [ ] **Step 4: Run focused and existing account tests**

Run:
- `node --test tests/v1_admin_account_connections.test.mjs`
- existing admin account tests selected by filename match if present.

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add workspace broker onboarding`

---

### Task 5: Wire runtime dependencies and preserve fail-closed behavior

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin.js`
- Modify: `cloudflare-v2/src/v1_entry.js` and/or the existing runtime composition file actually constructing admin handlers.
- Create or modify: appropriate admin integration test under `cloudflare-v2/tests/`.

**Interfaces:**
- Admin source/account handlers receive `env` so they can use `TRADING_MASTER_KEY` for encryption.
- No plaintext credentials pass through persistence adapters after handler completion.

- [ ] **Step 1: Write failing integration test**

Exercise authorized admin request composition and prove POST source/account reaches the new handlers with `TRADING_MASTER_KEY` available.

Also prove missing master key fails with stable server error and does not insert plaintext credentials.

- [ ] **Step 2: Run test and verify RED**

Run the focused integration test.

- [ ] **Step 3: Wire env/store dependencies minimally**

Follow current dependency injection patterns; do not restructure unrelated routing.

- [ ] **Step 4: Run integration tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: wire secure connection onboarding runtime`

---

### Task 6: Full regression and migration apply

**Files:**
- Modify: `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`
- Modify if controlling state changes: `AGENTS.md`

**Interfaces:**
- No new runtime feature flag required for storing connections.
- Broker execution master gate remains false.

- [ ] **Step 1: Run full repository CI-equivalent tests**

Run via GitHub Actions exact-head CI and verify:
- Worker/trading-core tests pass.
- pure MT5 bridge tests pass.
- pure MTProto Python tests pass.

- [ ] **Step 2: Apply migration 0014 to Mkety Supabase**

Use Supabase `apply_migration` with the exact reviewed SQL. Then verify column, RLS/grants posture, and run security/performance advisors as required by Supabase skill.

- [ ] **Step 3: Re-run exact-head CI after any migration-contract/doc updates**

Expected: GREEN.

- [ ] **Step 4: Update production handoff**

Record exact commits, CI run/job IDs, migration timestamp/name, security posture, and that no real external accounts or money-moving execution were enabled.

- [ ] **Step 5: Commit**

Commit message: `docs: record self-service connection checkpoint`

---

### Task 7: Product-path non-live acceptance

**Files:**
- Add focused acceptance test/harness only if existing admin integration tests cannot exercise the full path without external credentials.

**Interfaces:**
- Create a source/account using synthetic credentials through the same authorized admin handler path.
- Verify database-bound payload contains encrypted envelope only.
- Verify returned payload contains no secrets.
- Verify account execution remains false.

- [ ] **Step 1: Write acceptance test using synthetic credential values**

Do not call Telegram, MT5, or cTrader externally.

- [ ] **Step 2: Run acceptance test**

Expected: PASS and no credential plaintext in output snapshots/logging.

- [ ] **Step 3: Run exact-head CI one final time**

Expected: GREEN.

- [ ] **Step 4: Update handoff exact next pickup**

Next external step should be connecting a demo/test provider through this product onboarding path, not editing GitHub staging secrets for customer configuration.

- [ ] **Step 5: Commit**

Commit message: `test: prove self-service connection product path`
