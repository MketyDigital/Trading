# Access Reissue Rotation Safety Design

## Goal

Make access reissue a true credential rotation that preserves the existing enterprise workspace and all unrelated configuration while immediately invalidating predecessor access.

## Scope

This change applies to Mkety staff trading-access issuance/reissue, returning-session validation, and production cleanup of test/diagnostic trading-access records. It must not enable LIVE trading or alter broker/runtime safety posture.

## Required behavior

1. Reissue keeps the same workspace ID and owner identity.
2. Reissue preserves existing workspace configuration and metadata. It must not erase branding, destination templates, routes, sources, broker configuration, hostname/subdomain configuration, or unrelated metadata.
3. Reissue is additive for entitlements by default. Existing granted entitlements remain; explicitly newly selected entitlements are added. Reissue must not silently remove prior access.
4. Creating a replacement access code for an existing workspace revokes every prior active access code for that workspace before the replacement is considered current.
5. The new access code becomes the workspace current access credential. Old codes must fail immediately.
6. Returning refresh sessions and locally issued bearers must be bound to the current credential generation/access-code identity so sessions issued under a superseded code fail immediately after rotation.
7. New-customer creation remains supported and does not require rotation state.
8. Staff UI must distinguish Create from Reissue/Rotate and must reuse the canonical workspace.
9. Tests and diagnostics must not leave persistent production customer/workspace artifacts after acceptance.
10. Production cleanup keeps only the legitimate trading customers requested by the operator: `fxhighpriest01@gmail.com` (Starpips Forex) and `mkpoikankes@gmail.com` (Mkay). Cleanup must be dependency-aware and must preserve canonical real workspace state.
11. The Starpips reissue that added Telegram must preserve all existing Starpips configuration and result in Telegram plus the previously granted trading access.
12. LIVE execution must remain disabled before, during, and after implementation and acceptance.

## Data model approach

Use the existing workspace as the durable identity boundary. Store the current access-code identity/generation in access workspace/membership metadata rather than creating a replacement workspace. Access-code rotation updates only access-specific metadata and merges it into existing metadata.

The canonical current access-code identity is checked during returning-session restoration. Tokens include the access-code identity or generation from which they were issued. If that token binding does not match the workspace current access-code identity, restoration is denied and refresh cookies are cleared by the existing HTTP layer.

## Reissue transaction behavior

For an existing workspace:

- load current workspace and its metadata;
- verify requested owner matches the workspace owner;
- merge current entitlements with newly requested entitlements;
- create the new access-code row for the same workspace;
- revoke other active access-code rows for the workspace;
- update only access-specific metadata by merging into existing workspace metadata;
- leave destination templates and other workspace-scoped configuration untouched.

If rotation cannot complete consistently, fail closed rather than leaving two active codes.

## Production cleanup

Identify rows by explicit test/diagnostic owner patterns and known synthetic records. Remove dependent test data before parent workspace/access rows. Do not blanket-delete by age or by generic domain alone. Preserve the canonical Starpips workspace and canonical Mkay workspace; inspect legacy Mkay rows for dependencies before removal.

## Verification

Regression coverage must prove:

- branding/unrelated workspace metadata survives reissue;
- Telegram can be added without dropping prior entitlements;
- old code is revoked on rotation;
- old refresh session is rejected after rotation;
- new code works on the same workspace;
- no duplicate workspace is created;
- new-customer creation still works;
- test cleanup isolation prevents production pollution;
- LIVE remains false.

This design extends PR #89 and must not regress the existing stabilization work.