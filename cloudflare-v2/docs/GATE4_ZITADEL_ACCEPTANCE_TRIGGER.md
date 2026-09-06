# Gate 4 Zitadel Identity Acceptance Trigger

This file is the deliberate trigger surface for the protected Gate 4 non-live identity acceptance workflow.

## What Gate 4 proves

Gate 4 validates the real managed Mkety Zitadel identity plane against Trading-owned authorization state without enabling broker execution or ordinary Trading product access. The protected runner uses the same production JWT verification, project/org binding, Trading workspace entitlement, immutable `sub` membership, and Trading role-permission functions used by the application.

The acceptance matrix includes:

- existing Mkety logical user with explicit Trading membership;
- Trading-only identity with no MKSaaS database dependency;
- wrong Trading project rejection;
- wrong Zitadel organization rejection;
- missing Trading membership rejection;
- disabled Trading membership rejection;
- disabled Trading workspace entitlement rejection;
- `owner`, `admin`, `operator`, and `viewer` permission contracts;
- proof that no Trading workspace role grants `broker.execute`;
- second-tenant positive authorization in its own workspace;
- cross-tenant denial in both directions.

## Safety boundary

The protected job must run with:

```text
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

The runner is read-only. It must not create, enable, disable, promote, demote, or delete workspace memberships or entitlements. It must not deploy Workers, mutate Cloudflare, place broker orders, or modify MKSaaS state. Test identities/workspaces/memberships must be deliberately prepared in the non-live environment before triggering the workflow.

Do not store or print bearer tokens, service-role credentials, or other secret values. GitHub `staging` environment secrets supply the protected values at runtime.

## Required staging preparation

Prepare deliberately non-live Trading workspaces and test subjects so the protected matrix has known expected outcomes:

1. one enabled primary Trading workspace bound to the exact intended Zitadel organization;
2. one enabled second-tenant Trading workspace bound to a different organization;
3. one disabled-entitlement Trading workspace;
4. valid existing-Mkety and Trading-only subjects with enabled memberships in the primary workspace;
5. enabled owner/admin/operator/viewer subjects in the primary workspace;
6. a valid primary-org subject with no Trading membership;
7. a valid primary-org subject whose Trading membership is disabled;
8. a token from the wrong Trading project;
9. a token with the Trading project role for the wrong organization;
10. an enabled second-tenant subject in the second workspace.

All identities are authorized by immutable Zitadel `sub`, never by email. Trading authorization must remain independent of MKSaaS database rows.

## Deliberate trigger

Only after the staging secrets/test state above have been reviewed and real Gate 4 execution has been explicitly authorized, update this trigger file and push a commit whose **entire commit message is exactly**:

```text
identity: accept zitadel gate 4
```

The protected workflow first runs the ordinary Node/MT5/MTProto regression suite. Only if it passes, the exact branch/message marker matches, and the GitHub `staging` environment allows the job will the read-only real identity acceptance runner execute.

Merely adding or editing the workflow/runner does not authorize or trigger Gate 4 real acceptance.

Acceptance trigger: 2026-09-06 post-CodeQL GREEN read-only identity verification.
Acceptance trigger: 2026-09-06 production path after Gate 2 passed and Gate 3 blocked on custom-domain 503 readiness.
