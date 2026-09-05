# Mkety Identity and Trading Access Boundary

## Authoritative model

Mkety uses **one managed Mkety Zitadel instance** as the mother identity authority. Trading does not depend directly on Zitadel project-role or organization claims at its application boundary.

```text
One managed Mkety Zitadel instance
        -> Mkety identity / product-access gate
        -> short-lived signed Trading access assertion
        -> Mkety Trading
             -> trading_workspace_access
             -> trading_workspace_memberships
```

Trading therefore remains independently deployable and operational while external access is disabled. Zitadel can evolve behind Mkety without requiring Trading business logic to understand Zitadel internals.

## Signed Trading access assertion

After Mkety authenticates a user and confirms Trading product access, Mkety issues a short-lived cryptographically signed assertion intended specifically for Trading. The assertion contract contains, conceptually:

```json
{
  "sub": "user_123",
  "product": "trading",
  "workspace_id": "ws_example",
  "access": "owner",
  "iss": "https://access.mkety.com",
  "aud": "mkety-trading",
  "iat": 0,
  "exp": 0,
  "jti": "unique-assertion-id"
}
```

A reusable plain access code is not authorization.

Trading verifies the assertion using Mkety-controlled public signing keys/JWKS. The production Trading boundary requires:

1. valid cryptographic signature from the configured Mkety access issuer;
2. exact trusted issuer;
3. audience including the configured Mkety Trading audience;
4. token not expired and not before its valid time;
5. immutable subject (`sub`) present;
6. `product == "trading"`;
7. asserted `workspace_id` exactly matches the requested Trading workspace;
8. `access == "owner"` for the current one-owner enterprise product model.

## Supabase remains final application authorization

A valid Mkety assertion is necessary but not sufficient. Trading must then verify its own server-owned data:

1. the requested workspace exists in `trading_workspace_access`;
2. `trading_access_enabled` is true for that workspace;
3. the assertion subject has an exact enabled `(workspace_id, zitadel_subject)` row in `trading_workspace_memberships`.

The historical column name `zitadel_subject` remains for compatibility, but V1 Trading authorization treats the stored value as the immutable Mkety identity subject. Trading does not query Zitadel directly to authorize the workspace.

Disabling the Trading workspace or exact subject membership therefore revokes application access even if a previously issued short-lived assertion has not yet expired.

## Product isolation

A user may have MKSaaS access, Trading access, both, or neither. A Trading-only enterprise owner is valid and does not require an MKSaaS database profile or MKSaaS application access.

Trading authorization must not query the MKSaaS database or shared Mkety workspace tables. `trading_workspace_access` and `trading_workspace_memberships` remain Trading-owned server-side authority.

## One-owner product model

The V1 customer model is intentionally simple:

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Existing role/membership primitives may remain for compatibility and future needs, but they are not a reason to build a complex team, department, organization or seat-management product now. The signed external access contract is `access=owner`.

## Broker execution is separate

**Identity/access never enables broker execution by itself.** A valid Mkety assertion and enabled Trading workspace do not authorize a broker order.

Broker execution remains separately controlled by the Worker-wide execution fuse, exact trade-account state, per-account execution enablement, current source/workspace authority, risk/exposure policy, destination/order idempotency, kill switches and broker-authoritative metadata.

Real-money execution remains prohibited until a separate explicit owner approval records exact financial limits and rollback/kill procedure.

## Runtime configuration boundary

When `TRADING_ACCESS_ENABLED=false`, Trading core readiness does not require an identity provider or access-gate configuration.

Before `TRADING_ACCESS_ENABLED=true`, the Trading Worker requires:

- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

These point to the Mkety access-gate contract, not directly to Zitadel. Zitadel configuration belongs behind Mkety's identity/access layer.

## Non-live acceptance before enabling Trading access

Keep `TRADING_ACCESS_ENABLED=false` until a deployed non-live environment proves:

- valid Mkety-signed Trading owner assertion succeeds;
- wrong issuer fails;
- wrong audience fails;
- expired/not-yet-valid assertion fails;
- invalid signature fails;
- wrong product fails;
- wrong workspace fails;
- non-owner assertion fails;
- missing/disabled Trading membership fails;
- disabled Trading workspace fails;
- existing Mkety user succeeds when entitled;
- Trading-only user succeeds without an MKSaaS DB profile;
- no secret values appear in logs/responses;
- broker execution remains disabled.

Only after those positive and negative cases pass should non-money-moving Trading access be enabled for staging acceptance.

## Zitadel's role

Zitadel remains the mother Mkety identity provider. Mkety may create a Trading-related project/application as part of its identity/product configuration, but Trading's own runtime authorization contract is the signed Mkety assertion described above.

This keeps the boundary replaceable:

```text
Zitadel today (or another identity provider later)
        -> Mkety identity/product gate
        -> stable signed Trading assertion contract
        -> Trading
```

Trading should not need to know which Zitadel organization, project-role claim shape, or other identity-provider-specific detail produced the Mkety entitlement.
