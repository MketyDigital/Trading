# Mkety Shared Zitadel Enterprise Identity Design

Date: 2026-09-02
Status: Proposed / user-approved architecture pending written-spec review
Repository: `MketyDigital/Trading`

## 1. Purpose

Mkety Trading is an enterprise product of Mkety, not a standalone identity silo. Mkety should operate one managed Zitadel identity system while allowing users to access MKSaaS, Trading, or both. Trading must remain independently deployable and must use its own database, workspaces, credentials, runtime state, source/destination configuration, broker accounts, and authorization data.

The design must support two valid Trading users through the same Zitadel instance:

1. an existing MKSaaS/Mkety user who is granted Trading access; and
2. a Trading-only user who authenticates through the same Mkety Zitadel instance but has no row/account/profile in the main MKSaaS database.

Successful Zitadel authentication alone must never grant Trading access. Trading access is an explicit enterprise entitlement.

## 2. Goals

- One Mkety identity authority: one managed Zitadel instance.
- No second Trading password/user system.
- MKSaaS and Trading remain separate products with separate databases.
- A single Zitadel subject can access either or both products.
- Trading-only users do not require an MKSaaS database record.
- Trading enterprise customers receive isolated Trading workspaces.
- Trading roles and entitlements remain product-specific.
- Existing Trading tenant/workspace isolation remains authoritative for operational data.
- The architecture must work on the current managed Zitadel tier and remain unchanged when the Zitadel plan is upgraded later.
- No dependency on email as the permanent cross-product identity key.

## 3. Non-goals

- Do not merge the Trading database with the MKSaaS database.
- Do not make MKSaaS `users` or `workspaces` tables authoritative for Trading.
- Do not introduce a second Zitadel instance for Trading.
- Do not automatically grant Trading access to every authenticated Mkety/Zitadel user.
- Do not make Trading runtime availability depend on the MKSaaS application being online.
- Do not enable broker/live execution as part of identity integration.
- Do not require a Trading-only user to create a normal MKSaaS product profile.

## 4. Recommended Zitadel topology

Use the existing managed Mkety Zitadel instance as the global identity plane.

```text
Mkety Zitadel instance
|
+-- MKSaaS project
|   +-- MKSaaS web/API applications
|
+-- Mkety Trading project
    +-- Trading web application
    +-- Trading API/resource application
```

MKSaaS and Trading use the same human/user identities but separate project/application authorization boundaries.

A configured Trading API should validate tokens against the Mkety Zitadel issuer and the Trading API's intended audience. If `ZITADEL_PROJECT_ID` is configured, Trading must continue to require the exact project-specific role claim and must never fall back to a generic current-project role claim.

## 5. Identity authority

The authoritative cross-product user identifier is the immutable Zitadel token subject (`sub`). Email, username, display name, and MKSaaS database IDs are attributes only and must not be used as the permanent Trading identity key.

Trading should treat these token facts separately:

- `sub`: who the user is;
- issuer/audience/signature/time claims: whether the token is authentic and intended for Trading;
- Zitadel organization/project-role claims: what identity-level organization/role context is asserted;
- Trading database entitlement: whether this user is actually allowed to enter a particular Trading workspace.

Authentication and entitlement are separate gates.

## 6. Enterprise customer / workspace model

Each enterprise Trading customer normally receives its own Trading workspace in the Trading database.

```text
Zitadel organization/customer identity context
        |
        +-- Trading workspace
            +-- owner
            +-- admin
            +-- operator/trader
            +-- viewer
```

The Trading workspace is a Trading-owned resource. It may reference the relevant Zitadel organization ID for authorization, but it must not require a corresponding MKSaaS database workspace row.

A Trading-only customer can therefore have:

- a Zitadel identity;
- a Zitadel organization/customer context where appropriate;
- a Trading workspace and Trading entitlement;
- zero MKSaaS database records.

If that customer later adopts MKSaaS, the same Zitadel identity can be granted MKSaaS access without changing their Trading identity.

## 7. Dual access flows

### 7.1 Existing MKSaaS/Mkety user

```text
User signs into Mkety/MKSaaS
-> Zitadel authenticates existing subject
-> user opens Trading product
-> Trading validates Zitadel token
-> Trading resolves exact Trading entitlement/workspace
-> access granted only when entitlement is enabled
```

No second Trading login account is created.

### 7.2 Trading-only user

```text
User enters Trading directly
-> same Mkety Zitadel instance handles login/registration/authentication
-> Trading validates Zitadel token
-> Trading resolves explicit Trading enterprise entitlement
-> Trading workspace access is granted
-> no MKSaaS database profile is required
```

The fact that the user does not exist in the MKSaaS database must not cause Trading authentication or authorization failure.

### 7.3 Authenticated but not entitled

```text
Valid Zitadel identity
-> Trading token validation succeeds
-> no enabled Trading entitlement
-> access denied / enterprise activation flow
```

This is a normal state, not an authentication error.

## 8. Entitlement-controlled access

Trading is an enterprise product, so access should be described as **entitlement-controlled**, not simply "invite only" or "open signup".

Multiple business processes may grant the same Trading entitlement later:

- Mkety admin/sales activation;
- enterprise owner invitation;
- automated provisioning after an enterprise purchase/contract;
- trial/proof-of-concept provisioning;
- support/admin recovery.

All of these must converge on the same server-side Trading entitlement model. The authentication model must not change based on which business workflow granted access.

## 9. Trading database boundary

The current Trading-owned access layer remains the product authorization authority. `trading_workspace_access` should evolve to support user-subject membership explicitly while retaining organization/workspace entitlement semantics.

Conceptually, the access model needs to represent at least:

```text
workspace_id
zitadel_subject
zitadel_org_id (when organization-bound)
access_enabled
trading_role
created_at / updated_at
```

Exact schema changes must be designed and migrated additively after current live structure is inspected. Existing rows and disabled staging entitlement must be preserved during migration.

The Trading database remains authoritative for:

- Trading workspace membership;
- source connections;
- Telegram sessions/provider configuration;
- source credentials;
- AI provider configuration;
- trade accounts;
- destination integrations;
- risk/safety policy;
- Position Groups and legs;
- event/destination idempotency;
- retry/recovery state;
- Trading audit state.

None of those may be read from or written to the MKSaaS database as an authentication shortcut.

## 10. Role model

Zitadel project roles answer the broad product-level question: is this identity permitted to operate within the Trading product/project context?

Trading database roles answer the workspace-level question: what may this subject do inside this exact Trading workspace?

Recommended Trading workspace roles:

- `owner`: full workspace ownership and membership administration;
- `admin`: operational administration excluding ownership transfer unless separately authorized;
- `operator`: source/trading operations within configured policy;
- `viewer`: read-only observability/audit.

The exact permission matrix should be implemented later as a separate authorization slice. No role should bypass workspace matching, execution safety, or credential isolation.

## 11. Organization mapping

Where an enterprise customer has a Zitadel organization, the Trading workspace should bind to that organization using `zitadel_org_id`.

Authorization should require all applicable dimensions to match:

```text
valid token
AND correct issuer/audience
AND correct Trading project-role claim when configured
AND exact Zitadel subject
AND exact Trading workspace entitlement
AND exact organization binding when workspace is organization-bound
```

A valid role from another organization, another project, or another Trading workspace must not grant access.

Trading-only users may still be provisioned into an appropriate Zitadel organization/customer context without requiring MKSaaS database creation.

## 12. Product discovery / SSO experience

The user experience should eventually feel like one Mkety account:

```text
Mkety identity
  +-- MKSaaS entitlement (optional)
  +-- Trading entitlement (optional)
```

An MKSaaS user with Trading access can launch Trading without creating another identity. A Trading-only user can use the Trading entrypoint and the same Mkety Zitadel login without being forced through MKSaaS onboarding.

The applications may have separate sessions/cookies depending on deployment domains and OIDC client configuration, but the user identity remains one Zitadel subject. Seamless SSO should be preferred where the Zitadel/browser session permits it; security must not depend on shared application cookies.

## 13. Provisioning rules

Provisioning must be explicit and idempotent.

For a new enterprise customer:

1. establish or select the appropriate Zitadel organization/customer identity context;
2. ensure the user has the intended Trading project role/grant;
3. create the Trading workspace in the Trading database;
4. add the user subject as enabled workspace owner;
5. leave broker execution disabled;
6. provision sources/destinations independently after workspace creation.

For an existing Mkety user, reuse the existing Zitadel `sub`; do not create a second identity.

For a Trading-only user, create/authenticate the user in the same Zitadel instance and provision only Trading entitlement/workspace data unless they separately acquire MKSaaS access.

## 14. Deprovisioning rules

Disabling Trading access must not delete or disable the global Zitadel identity unless the identity itself is being removed from Mkety.

Product-level revocation should disable the relevant Trading membership/entitlement. Workspace-level revocation should remove/disable only that exact workspace membership.

Removing MKSaaS access must not implicitly remove Trading access, and removing Trading access must not implicitly remove MKSaaS access, unless an explicit business policy requests both.

## 15. Failure isolation

The shared identity plane must not reintroduce cross-product runtime coupling.

- MKSaaS database outage must not make an already-valid Trading entitlement lookup depend on MKSaaS data.
- Trading database outage must not affect MKSaaS login/product access.
- One enterprise customer's Trading entitlement failure must not affect another customer's entitlement.
- One Trading workspace cannot access another workspace because both users authenticate through the same Zitadel instance.
- Product role changes must not mutate unrelated source/broker/runtime state.
- Zitadel outage can prevent new token validation/login as expected, but existing application/runtime data must remain segregated; no fallback to insecure local identity is allowed.

## 16. Security invariants

1. Never authorize Trading from email alone.
2. Never authorize Trading solely because the user exists in Zitadel.
3. Never authorize Trading solely because the user exists in the MKSaaS database.
4. Never require an MKSaaS database user row for a Trading-only customer.
5. Never accept browser-supplied workspace/org identifiers as authority without server-side entitlement verification.
6. Never allow a generic project role to satisfy an explicitly configured Trading project-ID role requirement.
7. Never expose Zitadel management credentials to the browser or source/broker adapters.
8. Never couple Trading workspace membership to broker execution enablement.
9. Keep `trading_access_enabled=false` for current staging entitlement until real Zitadel project/org/role acceptance is completed.
10. Preserve the existing Trading rule that one tenant/source/destination/integration failure cannot affect unrelated tenants/integrations.

## 17. Current managed Zitadel tier

The architecture must not depend on paid-only behavior. The current managed Zitadel plan is acceptable for development/early validation as long as its operational usage limits are monitored. A future plan upgrade must not require changing identifiers, user records, Trading workspaces, or the authorization architecture.

Plan limits are an operational/capacity concern, not an application authorization concern.

## 18. Compatibility with current Trading implementation

This design intentionally preserves the security decisions already implemented:

- cryptographic Zitadel JWT verification;
- issuer/audience/time validation;
- strict project-specific role behavior when `ZITADEL_PROJECT_ID` is configured;
- workspace-bound organization checks;
- Trading-owned `trading_workspace_access` authority;
- independent Trading database;
- `trading_access_enabled=false` until real authorization acceptance;
- no dependency on shared Mkety `public.workspaces`.

The main extension is to make **Zitadel subject membership** a first-class Trading entitlement so multiple users can belong to one enterprise Trading workspace and a Trading-only user can be authorized without any MKSaaS database record.

## 19. Implementation sequencing

Implementation should be split into controlled slices after this written design is approved:

1. inspect the exact current Trading access schema and JWT/admin authorization interfaces;
2. design/add an additive subject-to-workspace membership model without breaking current entitlement rows;
3. update authorization to resolve subject + organization + workspace + role independently of MKSaaS database state;
4. add acceptance tests for MKSaaS-user, Trading-only-user, unauthorized-Zitadel-user, wrong-org, wrong-project, wrong-workspace and disabled-membership scenarios;
5. add provisioning/admin APIs separately, with role controls and no broker execution side effects;
6. later integrate MKSaaS product discovery/launch flow through the same Zitadel instance in the MKSaaS repo;
7. perform real non-live Zitadel environment acceptance before enabling current Trading entitlement.

## 20. Acceptance criteria

The design is correctly implemented only when tests prove all of the following:

- the same Zitadel `sub` can be entitled to both MKSaaS and Trading without a second identity;
- a Trading-only Zitadel subject with no MKSaaS database record can access its Trading workspace;
- a valid Zitadel subject without Trading entitlement is denied;
- one enterprise workspace can contain multiple Zitadel subjects with independent Trading roles;
- wrong workspace/org/project/role claims fail closed;
- disabling one membership does not affect another membership or another product;
- no authorization code queries the MKSaaS database to establish Trading identity;
- no broker/source/destination execution or credentials are changed by identity provisioning;
- current multi-tenant source/destination isolation remains unchanged;
- real Trading access remains disabled until non-live Zitadel environment acceptance is green.
