# Mkety Shared Zitadel Enterprise Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Mkety Trading so one managed Mkety Zitadel identity system can authorize both existing MKSaaS users and Trading-only users through explicit, workspace-scoped Trading memberships, without requiring or querying the MKSaaS database.

**Architecture:** Keep `trading_workspace_access` as the Trading-owned workspace/org entitlement switch and add a separate service-only `trading_workspace_memberships` table keyed by `(workspace_id, zitadel_subject)`. JWT verification and project/org role validation remain in `zitadel_auth.js`; `authorizeV1AdminRequest` additionally resolves the exact authenticated subject's enabled Trading membership before any admin operation. Workspace roles (`owner`, `admin`, `operator`, `viewer`) are Trading-database roles and never imply broker execution enablement.

**Tech Stack:** Cloudflare Workers, Node.js ESM, Supabase/PostgreSQL, Zitadel OIDC/JWT, Wrangler, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`

## Global Constraints

- One managed Mkety Zitadel instance is the global identity authority.
- MKSaaS and Trading remain separate products with separate databases.
- A Trading-only user must not require an MKSaaS database row.
- `sub` is the permanent user identity key; never email.
- Successful Zitadel authentication alone must never grant Trading access.
- `trading_workspace_access` remains the Trading workspace/org entitlement authority.
- Existing `trading_access_enabled=false` staging state must remain disabled until real non-live Zitadel acceptance.
- When `ZITADEL_PROJECT_ID` is configured, only the matching project-specific role claim may authorize.
- All new Trading authorization tables remain service-role-only with RLS enabled and no anon/authenticated policies.
- No task may enable broker/live execution, create broker credentials, or query the MKSaaS database.
- Existing multi-tenant source/destination/retry/idempotency isolation must remain unchanged.
- TDD is mandatory: exact RED before production code, full four-gate GREEN after each meaningful batch.
- Update `AGENTS.md` and this plan after every meaningful GREEN checkpoint.

---

### Task 1: Add service-only subject-to-workspace membership schema

**Files:**
- Create: `cloudflare-v2/db/migrations/0009_trading_workspace_memberships.sql`
- Create: `cloudflare-v2/tests/trading_workspace_memberships_migration.test.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces table `public.trading_workspace_memberships` with columns: `id UUID`, `workspace_id UUID`, `zitadel_subject TEXT`, `trading_role TEXT`, `membership_enabled BOOLEAN`, `metadata JSONB`, `created_at`, `updated_at`.
- Unique identity boundary: `(workspace_id, zitadel_subject)`.
- Allowed roles: `owner`, `admin`, `operator`, `viewer`.
- `workspace_id` references `trading_workspace_access(id) ON DELETE CASCADE`.

- [ ] **Step 1: Write the failing migration contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../db/migrations/0009_trading_workspace_memberships.sql', import.meta.url), 'utf8');

test('membership migration creates a service-only workspace+subject boundary', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.trading_workspace_memberships/i);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES public\.trading_workspace_access\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /zitadel_subject TEXT NOT NULL/i);
  assert.match(sql, /trading_role TEXT NOT NULL CHECK \(trading_role IN \('owner', 'admin', 'operator', 'viewer'\)\)/i);
  assert.match(sql, /membership_enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
  assert.match(sql, /UNIQUE\s*\(workspace_id, zitadel_subject\)/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.trading_workspace_memberships FROM anon/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.trading_workspace_memberships FROM authenticated/i);
  assert.match(sql, /GRANT ALL PRIVILEGES ON TABLE public\.trading_workspace_memberships TO service_role/i);
});
```

- [ ] **Step 2: Run the focused test and verify exact RED**

Run: `node --test tests/trading_workspace_memberships_migration.test.mjs`

Expected: FAIL because migration `0009_trading_workspace_memberships.sql` does not exist.

- [ ] **Step 3: Add the additive migration**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.trading_workspace_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.trading_workspace_access(id) ON DELETE CASCADE,
    zitadel_subject TEXT NOT NULL,
    trading_role TEXT NOT NULL CHECK (trading_role IN ('owner', 'admin', 'operator', 'viewer')),
    membership_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, zitadel_subject)
);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_subject
    ON public.trading_workspace_memberships(zitadel_subject, membership_enabled);
CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_workspace
    ON public.trading_workspace_memberships(workspace_id, membership_enabled);

ALTER TABLE public.trading_workspace_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_memberships FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.trading_workspace_memberships FROM authenticated;
GRANT ALL PRIVILEGES ON TABLE public.trading_workspace_memberships TO service_role;

COMMIT;
```

- [ ] **Step 4: Run focused test, then all four mandatory gates**

Run: `npm test`, pure MT5 tests, both MTProto Python suites, Wrangler dry-run.

Expected: all GREEN.

- [ ] **Step 5: Commit and update handoff**

Commit message: `feat: add trading workspace subject memberships`

Record exact RED/GREEN run IDs and commit in `AGENTS.md` and mark Task 1 complete here.

---

### Task 2: Add membership store and membership-aware admin authorization

**Files:**
- Create: `cloudflare-v2/src/security/trading_membership_store.js`
- Create: `cloudflare-v2/tests/trading_membership_store.test.mjs`
- Modify: `cloudflare-v2/src/http/v1_admin.js`
- Modify: `cloudflare-v2/tests/v1_admin.test.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces `createTradingMembershipStore(supabase)`.
- Produces `getMembership(workspaceId, zitadelSubject)` returning normalized `{ id, workspaceId, subject, role, enabled, metadata } | null`.
- `authorizeV1AdminRequest` authenticates token/project/org first, then looks up exact `(workspace.id, auth.subject)` membership.
- Disabled or missing membership returns `403 TRADING_MEMBERSHIP_DISABLED_OR_MISSING`.
- No membership lookup may use email, caller body, or MKSaaS data.

- [ ] **Step 1: Write failing store tests**

Test exact workspace+subject query, normalized role, null on no row, and database error fail-closed.

```js
const membership = await store.getMembership('ws-1', 'zitadel-user-1');
assert.equal(membership.workspaceId, 'ws-1');
assert.equal(membership.subject, 'zitadel-user-1');
assert.equal(membership.role, 'admin');
```

- [ ] **Step 2: Write failing admin authorization tests**

Add cases proving:
- valid Zitadel role/org + enabled matching membership => authorized;
- valid Zitadel role/org + no membership => 403;
- membership for same subject in another workspace => 403;
- disabled membership => 403;
- membership lookup receives `auth.subject`, not email or request body;
- Trading-only user succeeds without any MKSaaS lookup/dependency.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/trading_membership_store.test.mjs tests/v1_admin.test.mjs`

Expected: failures because membership store/gate do not exist.

- [ ] **Step 4: Implement minimal store**

```js
export function createTradingMembershipStore(supabase) {
  if (!supabase?.from) throw new Error('TRADING_MEMBERSHIP_STORE_UNAVAILABLE');
  return {
    async getMembership(workspaceId, subject) {
      const { data, error } = await supabase
        .from('trading_workspace_memberships')
        .select('id,workspace_id,zitadel_subject,trading_role,membership_enabled,metadata')
        .eq('workspace_id', String(workspaceId))
        .eq('zitadel_subject', String(subject))
        .maybeSingle();
      if (error) throw new Error('TRADING_MEMBERSHIP_LOOKUP_FAILED');
      if (!data) return null;
      return {
        id: data.id,
        workspaceId: String(data.workspace_id),
        subject: String(data.zitadel_subject),
        role: String(data.trading_role),
        enabled: Boolean(data.membership_enabled),
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
      };
    },
  };
}
```

- [ ] **Step 5: Integrate membership into `authorizeV1AdminRequest`**

After `authenticateTradingBearer` returns `{ ok: true, subject }`, resolve the exact membership from the same Trading Supabase connection. Fail closed before source/admin handlers. Return authorization context with `membership`.

- [ ] **Step 6: Run focused and full gates**

Expected: all GREEN; existing source HMAC ingestion and broker tests unchanged.

- [ ] **Step 7: Commit and update handoff**

Commit message: `feat: authorize trading admins by zitadel subject membership`

---

### Task 3: Enforce workspace role capabilities independently from Zitadel product role

**Files:**
- Create: `cloudflare-v2/src/security/trading_permissions.js`
- Create: `cloudflare-v2/tests/trading_permissions.test.mjs`
- Modify: `cloudflare-v2/src/http/v1_admin.js`
- Modify: `cloudflare-v2/src/http/v1_admin_sources.js`
- Modify: `cloudflare-v2/tests/v1_admin_sources.test.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- `hasTradingPermission(role, permission)`.
- Permission set:
  - `owner`: `workspace.read`, `members.read`, `members.write`, `sources.read`, `sources.write`.
  - `admin`: `workspace.read`, `members.read`, `members.write`, `sources.read`, `sources.write`.
  - `operator`: `workspace.read`, `sources.read`, `sources.write`.
  - `viewer`: `workspace.read`, `sources.read`.
- No role grants broker execution; execution remains controlled by trade-account safety policy.

- [ ] **Step 1: Write permission RED tests**

```js
assert.equal(hasTradingPermission('viewer', 'sources.write'), false);
assert.equal(hasTradingPermission('operator', 'sources.write'), true);
assert.equal(hasTradingPermission('admin', 'members.write'), true);
assert.equal(hasTradingPermission('unknown', 'workspace.read'), false);
```

- [ ] **Step 2: Add source-admin RED tests**

Prove viewer cannot enable/disable/set-default; operator can mutate sources; no role can escape authenticated workspace.

- [ ] **Step 3: Implement pure permission map and route checks**

Return `403 TRADING_PERMISSION_DENIED` before store mutation when capability is missing.

- [ ] **Step 4: Full GREEN + commit**

Commit message: `feat: enforce trading workspace role permissions`

Update `AGENTS.md` and plan with exact CI.

---

### Task 4: Add tenant-safe membership administration APIs

**Files:**
- Create: `cloudflare-v2/src/http/v1_admin_members.js`
- Create: `cloudflare-v2/tests/v1_admin_members.test.mjs`
- Modify: `cloudflare-v2/src/security/trading_membership_store.js`
- Modify: `cloudflare-v2/src/http/v1_admin.js`
- Modify: `AGENTS.md`

**Interfaces:**
- Routes under authenticated V1 admin boundary:
  - `GET /api/v1/admin/members`
  - `POST /api/v1/admin/members`
  - `POST /api/v1/admin/members/:subject/role`
  - `POST /api/v1/admin/members/:subject/enable`
  - `POST /api/v1/admin/members/:subject/disable`
- All operations bind to `authorization.workspace.id`; caller-supplied workspace/org values are ignored/rejected as authority.
- Only `owner`/`admin` with `members.write` can mutate membership.
- Valid roles only: owner/admin/operator/viewer.
- Preserve at least one enabled owner: disabling/demoting the last enabled owner must fail `409 LAST_WORKSPACE_OWNER`.
- API never creates/updates Zitadel users and never touches MKSaaS database.

- [ ] **Step 1: Write RED tests for list/create/role/enable/disable and cross-workspace isolation**

Include:
- owner can add Trading-only subject by immutable Zitadel `sub`;
- same subject can belong to two different workspaces independently;
- duplicate membership in same workspace is idempotent or conflicts deterministically without duplicate rows;
- admin cannot mutate foreign workspace via body/path tricks;
- viewer/operator cannot mutate members;
- last enabled owner cannot be disabled/demoted.

- [ ] **Step 2: Extend membership store with exact-workspace mutations**

Methods:
- `listMemberships(workspaceId)`
- `upsertMembership(workspaceId, subject, role)`
- `setMembershipRole(workspaceId, subject, role)`
- `setMembershipEnabled(workspaceId, subject, enabled)`
- `countEnabledOwners(workspaceId)`

All DB queries include exact `workspace_id`.

- [ ] **Step 3: Implement handler and route wiring**

Responses expose only subject, role, enabled, timestamps/metadata safe fields. No tokens, emails as authority, or Zitadel management credentials.

- [ ] **Step 4: Full GREEN + commit**

Commit message: `feat: add trading workspace membership administration`

Update `AGENTS.md` and plan.

---

### Task 5: Dual-access acceptance, static MKSaaS independence contract, and operational docs

**Files:**
- Create: `cloudflare-v2/tests/shared_zitadel_dual_access_acceptance.test.mjs`
- Create: `cloudflare-v2/docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`
- Modify: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Modify: `AGENTS.md`
- Modify: this plan

**Interfaces:**
- Acceptance uses real Trading authorization functions/stores with deterministic test doubles; no live broker/Zitadel secrets.
- Proves two logical entry paths converge on the same `sub` membership gate.

- [ ] **Step 1: Write acceptance tests**

Prove:
1. existing-Mkety logical user (`sub=user-1`) with enabled Trading membership succeeds;
2. Trading-only logical user (`sub=user-2`) with no MKSaaS record/dependency succeeds;
3. authenticated user with no Trading membership fails;
4. wrong project claim fails;
5. wrong org fails;
6. wrong workspace membership fails;
7. disabled membership fails without affecting another member;
8. two subjects in one workspace keep independent roles;
9. no auth module imports/queries the `MketyDigital/Mkety` database or a shared Mkety user/workspace table;
10. membership provisioning changes no source, destination, trade-account, or execution state.

- [ ] **Step 2: Add operator documentation**

Document topology:

```text
One Mkety Zitadel instance
  -> MKSaaS project/app (separate DB)
  -> Trading project/app (Trading DB)
       -> trading_workspace_access
       -> trading_workspace_memberships
```

Document that Zitadel login is identity only; membership is entitlement; broker execution remains separate.

- [ ] **Step 3: Update staging runbook**

Real non-live acceptance checklist must include:
- same issuer for Mkety identity plane;
- Trading-specific client/audience/project role;
- exact project/org claim test;
- exact `sub` membership test;
- Trading-only test identity that has no MKSaaS DB profile;
- entitlement remains disabled until negative/positive tests pass;
- no live broker account/execution.

- [ ] **Step 4: Run final verification**

Run all four mandatory CI gates at exact newest head. Also inspect newest branch workflow run before claiming GREEN.

- [ ] **Step 5: Update handoff**

`AGENTS.md` must record:
- migration `0009` checked in and whether it is actually applied live;
- exact RED/GREEN runs for Tasks 1–5;
- shared-Zitadel architecture as authoritative identity model;
- real account-side Zitadel/Cloudflare verification still external if connectors remain unavailable;
- real-money execution disabled and `main` unmerged.

Commit message: `docs: record shared zitadel enterprise identity acceptance`

---

## Completion Boundary

This plan is source/CI complete only when Tasks 1–5 are GREEN and `AGENTS.md` records the exact newest branch-head verification. It is **not** real-environment complete until the existing Mkety managed Zitadel instance is configured with the Trading project/app and non-live positive/negative project/org/subject membership tests pass against the deployed Worker. No code path may claim environment acceptance without that evidence.
