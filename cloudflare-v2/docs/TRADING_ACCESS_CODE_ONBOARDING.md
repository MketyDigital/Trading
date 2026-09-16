# Trading Access-Code and Subscription Lifecycle Spec

## Status

Current implementation spec for Trading V1 access-code onboarding, returning owner sessions, subscription revocation/expiry, and same-workspace renewal/reissue.

## Goal

Keep onboarding simple while preserving one durable Trading workspace per customer. Access-code replacement must rotate access to the same workspace rather than manufacture a new workspace or erase the customer's sources, routes, destinations, broker accounts, templates, branding, or other workspace configuration.

## Architecture

A Mkety-created access code is a bounded Trading access credential, not a permanent password and not trading authority. Initial redemption creates/activates the assigned Trading workspace and owner membership. Returning browser sessions use a short-lived bearer plus an HttpOnly refresh-session cookie.

Each current bearer/refresh session is bound to the workspace's current access-code ID. Reissue/rotation creates a replacement code for the same workspace and revokes prior active codes. A session bound to the old code is rejected as superseded and cannot renew itself.

Revocation is a workspace subscription lock. It disables `trading_workspace_access.trading_access_enabled` for the workspace whose metadata currently references that code, while preserving workspace rows, memberships, accounts, sources, routes, destinations, templates, settings, and audit history. Reissue/renewal on that same workspace restores workspace access and removes subscription-lock metadata.

Expiry is checked server-side during access-code use, returning-session restoration, and local bearer revalidation. Expired access is denied even if an old browser token has not yet reached its own JWT expiry; authenticated API revalidation also persists the workspace access-disabled state. Renewal/reissue restores access through the same atomic rotation path.

## Endpoints

Initial sign-in/onboarding:

```text
POST /api/v1/access/redeem
```

Returning browser session:

```text
POST /api/v1/access/session
```

Sign out and clear the HttpOnly refresh session:

```text
POST /api/v1/access/logout
```

Staff access administration:

```text
GET  /api/v1/mkety-admin/access-codes
POST /api/v1/mkety-admin/access-codes
POST /api/v1/mkety-admin/access-codes/:id/revoke
```

For a new customer, staff omit `workspaceId`. For reissue/renewal, staff submit the existing `workspaceId`; the server rotates the credential on that exact workspace.

## Redemption response shape

A successful redemption returns the same workspace identity plus a short-lived bearer and bounded entitlements. Trading access entitlements remain DEMO-only in the current stabilization phase:

```json
{
  "ok": true,
  "workspace": {
    "id": "uuid",
    "name": "Customer Trading Workspace"
  },
  "membership": {
    "role": "owner"
  },
  "entitlements": {
    "sourceTypes": ["telegram", "tradingview"],
    "brokerModes": ["demo"],
    "liveExecution": false
  },
  "bearer": "short-lived-workspace-bound-token"
}
```

## Security and lifecycle rules

- Public redemption remains disabled unless `TRADING_ACCESS_CODE_REDEMPTION_ENABLED=true`.
- Plaintext codes are never stored in the application database; normalized code hashes are persisted server-side.
- Codes must be product=`trading`, active, unexpired, and within their redemption constraints.
- Browser bearer and refresh tokens are workspace-scoped, owner-scoped, signed server-side, and include the current access-code binding for rotation invalidation.
- Returning-session restoration re-checks the persisted workspace, owner membership, current access-code ID, code status, and code expiry.
- Reissue/rotation uses the existing workspace ID and never creates a second workspace for that customer.
- Previous active codes are revoked only after the replacement code is created inside the atomic database rotation transaction.
- Revoking the current code locks only the referenced workspace. Membership enable/disable state is not rewritten by subscription revocation.
- Renewal preserves existing entitlements/configuration additively but always forces `brokerModes=["demo"]` and `liveExecution=false` in this stabilization stream.
- Access-code authentication never enables broker execution, account execution, LIVE execution, routes, or kill switches. Those remain independent persisted authorities.
- Server-side subscription lookup failure is fail-closed for bound sessions.
- The visible Sign out control calls the server logout endpoint before clearing local browser session state and reloading.
- Staff UI presents one customer-workspace row even when multiple historical access-code rows exist; history remains persisted for audit.

## Database lifecycle

The original access-code tables remain authoritative:

- `public.trading_access_codes`
- `public.trading_access_code_redemptions`

Migration `0034_atomic_access_code_rotation.sql` introduced atomic same-workspace access-code rotation.

Migration `0037_subscription_access_lifecycle.sql` extends that lifecycle by:

1. adding a trigger that locks the currently referenced workspace when its active Trading code is revoked;
2. redefining `public.rotate_trading_access_code(...)` so renewal/reissue restores the same workspace after a subscription lock;
3. preserving membership administration and workspace configuration;
4. forcing DEMO-only entitlements and `liveExecution=false`;
5. restricting security-definer execution and pinning an empty function `search_path` with schema-qualified database objects.

## Acceptance scope

Repository and production acceptance must prove:

1. valid initial code redemption works for the assigned workspace;
2. revoked, expired, wrong-product, or superseded access is rejected;
3. replacing a code preserves the workspace ID and existing workspace configuration;
4. an old access-code-bound bearer/refresh session cannot renew after reissue;
5. visible Sign out clears the server refresh session before local reload;
6. staff UI does not display historical codes as duplicate customer workspaces;
7. Telegram Bot API source token/chat controls are visible on the real composed Connections page;
8. global LIVE execution remains OFF, workspace `liveExecution` remains false, and every LIVE account remains execution-disabled during DEMO stabilization;
9. access lifecycle changes do not alter broker accounts, source routes, destination routing, trade-state/idempotency behavior, or independent destination failure isolation.

## Launch rule

A green repository suite is necessary but not sufficient. Apply schema changes first, deploy only from reviewed `main`, run production browser/session checks against a safe workspace, and re-query all LIVE safety controls after deployment. Passing DEMO or subscription acceptance does not authorize LIVE trading.
