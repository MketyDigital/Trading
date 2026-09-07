# Trading Access-Code Onboarding Spec

## Status

Approved implementation spec for Trading V1 access-code onboarding.

## Goal

Allow Mkety Trading Enterprise to launch with a simple one-time access-code flow while keeping the existing central Mkety/Zitadel access gateway as the long-term identity target.

## Architecture

The access-code flow is a Trading-owned onboarding path. A Mkety-created code is redeemed through a public endpoint, creates or activates a Trading workspace, creates an owner membership, and returns a short-lived Trading bearer that can be used in the existing dashboard.

The access code is not a permanent password. It is a bounded redemption key. After redemption, all dashboard/admin controls continue through the existing V1 workspace-scoped admin APIs.

## Endpoint

```text
POST /api/v1/access/redeem
```

Request body:

```json
{
  "code": "TRD-MKTY-EXAMPLE",
  "ownerEmail": "owner@example.com",
  "ownerName": "Owner Name",
  "workspaceName": "Customer Trading Workspace",
  "requestedSubdomain": "customer"
}
```

Response body:

```json
{
  "ok": true,
  "mode": "access_code_onboarding",
  "workspace": {
    "id": "uuid",
    "name": "Customer Trading Workspace"
  },
  "membership": {
    "role": "owner"
  },
  "entitlements": {
    "customSubdomain": true,
    "customHostname": false,
    "sourceTypes": ["telegram", "tradingview"],
    "brokerModes": ["demo"],
    "liveExecution": false,
    "maxTeamMembers": 1
  },
  "bearer": "short-lived-token-for-existing-dashboard"
}
```

## Security rules

- Disabled unless `TRADING_ACCESS_CODE_REDEMPTION_ENABLED=true`.
- Codes are normalized, hashed, and looked up server-side.
- Plaintext codes are never stored by the application store.
- Codes must be active, unexpired, product=`trading`, and within max redemption count.
- Redemption creates/activates exactly one Trading workspace and an owner membership.
- Local bearer is short-lived and scoped to product=`trading`, workspace ID, subject, and access=`owner`.
- Local bearer requires `TRADING_ACCESS_CODE_SESSION_SECRET`.
- The bearer does not enable broker execution. Broker execution remains governed by existing global/account/risk/idempotency locks.
- Redemption and replay decisions are auditable.

## Database additions

Add `public.trading_access_codes`:

- `id uuid primary key default uuid_generate_v4()`
- `code_hash text unique not null`
- `product text not null default 'trading'`
- `status text not null default 'active'`
- `workspace_id uuid references public.trading_workspace_access(id)`
- `workspace_display_name text`
- `owner_email text`
- `owner_name text`
- `role text not null default 'owner'`
- `entitlements jsonb not null default '{}'::jsonb`
- `max_redemptions integer not null default 1`
- `redeemed_count integer not null default 0`
- `expires_at timestamptz`
- `last_redeemed_at timestamptz`
- `metadata jsonb not null default '{}'::jsonb`
- timestamps

Enable RLS, revoke anon/authenticated, grant service_role.

Add `public.trading_access_code_redemptions` for audit.

## Preflight test scope

Preflight tests must prove:

1. A valid code produces a workspace owner onboarding plan.
2. Disabled/expired/used/wrong-product codes are rejected.
3. The public endpoint is fail-closed unless the redemption flag and session secret are configured.
4. Redeeming returns a short-lived bearer that the admin auth boundary can verify for the same workspace only.
5. Broker execution remains disabled unless existing execution gates are separately enabled.

## Launch rule

This flow can pre-pass repository and staging simulation. It does not replace final real frontend/demo testing by the owner before public launch.
