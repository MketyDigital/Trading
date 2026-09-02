# Shared Mkety Zitadel Enterprise Identity

## Authoritative identity model

Mkety uses **one managed Mkety Zitadel instance** as the global identity authority. Products remain independently entitled and independently persisted even though they share the same immutable Zitadel subject identity.

```text
One managed Mkety Zitadel instance
  -> MKSaaS project/app (separate DB)
  -> Trading project/app (Trading DB)
       -> trading_workspace_access
       -> trading_workspace_memberships
```

The immutable Zitadel `sub` is the cross-product person identity key. Email, display name, browser-supplied workspace identifiers, and MKSaaS profile rows are not Trading authorization authority.

## Identity is not entitlement

Successful Zitadel login proves identity only. Trading access additionally requires all of the following server-side checks:

1. the selected Trading workspace exists in `trading_workspace_access`;
2. Trading entitlement is enabled for that workspace;
3. the token is cryptographically valid for the configured Trading issuer/audience;
4. the required Trading project role is granted for the exact workspace-bound Zitadel organization;
5. the token `sub` has an exact enabled `(workspace_id, zitadel_subject)` row in `trading_workspace_memberships`;
6. that membership role grants the requested Trading route capability.

A user can therefore have MKSaaS access, Trading access, both, or neither. A **Trading-only** user is valid: the subject may authenticate through the same Mkety Zitadel instance and receive Trading access without any MKSaaS database profile.

Trading authorization must never query the MKSaaS database or shared Mkety user/workspace tables. `trading_workspace_access` and `trading_workspace_memberships` are Trading-owned server-side authority.

## Project and organization isolation

When `ZITADEL_PROJECT_ID` is configured, Trading accepts only the matching project-specific role claim:

```text
urn:zitadel:iam:org:project:<ZITADEL_PROJECT_ID>:roles
```

The generic current-project claim must not be used as fallback in that configuration. A role for another project or another organization fails closed before Trading membership lookup.

The authenticated workspace remains server authority. Membership in another Trading workspace does not authorize the selected workspace, even for the same Zitadel subject.

## Trading workspace roles

Trading workspace roles are independent from the broad Zitadel product role:

- `owner`: workspace read, member read/write, source read/write;
- `admin`: workspace read, member read/write, source read/write;
- `operator`: workspace read, source read/write;
- `viewer`: workspace read, source read only.

Unknown roles fail closed. Membership administration preserves at least one enabled owner; disabling or demoting the last enabled owner returns `LAST_WORKSPACE_OWNER`.

No workspace role grants broker execution.

## Broker execution is separate

**Broker execution remains separate from identity and membership entitlement.** A valid Trading login, enabled workspace membership, or owner/admin role does not enable order dispatch.

Broker execution remains controlled by explicit per-trade-account execution enablement, account safety/risk policy, destination idempotency, kill switches, broker metadata validation, and the environment's live/demo gates. Current source/CI identity work does not enable real-money execution.

## Membership administration

Authenticated owner/admin routes are scoped to the already-authorized Trading workspace:

```text
GET  /api/v1/admin/members
POST /api/v1/admin/members
POST /api/v1/admin/members/:subject/role
POST /api/v1/admin/members/:subject/enable
POST /api/v1/admin/members/:subject/disable
```

Memberships are addressed by immutable Zitadel `sub`. Caller-supplied workspace/org values are never authority. The same subject may belong to different Trading workspaces independently.

Membership provisioning changes only Trading membership state. It must not mutate source connections, destination delivery state, trade accounts, Position Groups, broker credentials, execution enablement, or broker actions.

## Migration state

Migration `0009_trading_workspace_memberships.sql` creates the Trading-owned subject membership boundary. It is checked into the active feature branch. Do not claim it is applied to the live Trading database until the live migration ledger/schema is explicitly verified after application.

Existing migrations `0001` through `0008` were previously verified applied to the shared Mkety Supabase project. Do not reapply them blindly.

## Non-live acceptance before enabling entitlement

Keep `trading_access_enabled=false` until a deployed non-live environment proves all of these with the intended Mkety Zitadel instance:

- same managed Mkety issuer identity plane;
- Trading-specific application/client and audience;
- exact Trading project claim;
- exact workspace-bound Zitadel organization claim;
- exact immutable `sub` membership;
- wrong project rejected;
- wrong organization rejected;
- missing membership rejected;
- disabled membership rejected;
- wrong-workspace membership rejected;
- an enabled existing-Mkety logical user succeeds;
- an enabled Trading-only identity with no MKSaaS DB profile succeeds;
- no secret values appear in logs/responses;
- no live broker account or real-money execution is enabled.

Only after the negative and positive identity cases pass should the intended non-live workspace entitlement be enabled for further source/runtime acceptance.

## Source/CI acceptance boundary

The repository acceptance suite proves the authorization composition and static independence contract using real Trading authorization functions/stores with deterministic test doubles. It proves that existing-Mkety and Trading-only logical users converge on the same Zitadel `sub` + Trading membership gate and that Trading auth code contains no MKSaaS/shared-workspace database dependency.

That is source/CI evidence only. It is not proof that the external Zitadel project/application, deployed Cloudflare Worker, or live Supabase migration `0009` are configured correctly. Those require separate non-live environment verification.
