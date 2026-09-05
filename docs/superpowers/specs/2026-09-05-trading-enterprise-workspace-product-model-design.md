# Mkety Trading Enterprise Workspace Product Model

**Status:** APPROVED / CONTROLLING

**Approved:** 2026-09-05

## Product definition
Mkety Trading is a standalone enterprise Trading product inside the wider Mkety ecosystem. It shares Mkety's managed Zitadel identity authority, but it does not require the MKSaaS application runtime or an MKSaaS database profile to operate.

The product is intentionally simple at the customer boundary:

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control**.

The Trading workspace is not a generic collaboration/team SaaS. Do not build departments, complex role hierarchies, seat management, nested organizations, broker-style team structures, or speculative membership UX unless a real customer requirement later proves them necessary.

Existing membership primitives may remain for compatibility/future use, but they are not a reason to build a complex team product now.

## Identity and authorization
Zitadel answers **who the user is and whether the user is entitled to Mkety Trading**.

Supabase/Trading data answers **which Trading workspace that authenticated owner controls**.

A Trading-only enterprise owner may authenticate through the same Mkety Zitadel identity authority without needing access to other Mkety/MKSaaS products.

The intended request boundary is:

`browser -> Mkety Zitadel login -> Trading API token validation -> workspace-owner lookup -> workspace-scoped Trading runtime/data`.

Authentication is independent from broker execution. A user may authenticate and operate non-money-moving Trading controls while `BROKER_EXECUTION_ENABLED=false`.

## Workspace ownership boundary
A Trading workspace is the isolation boundary for one enterprise customer. All Trading-owned sources, destinations, broker accounts, credentials, policies, events, Trade State, retries, recovery, logs and runtime data remain scoped to that workspace.

The enterprise owner has full control of the workspace. Internal operational choices are the customer's responsibility; Mkety does not need to model their internal company hierarchy for V1.

The custom hostname is never authorization authority. Hostname resolution identifies the requested workspace; Zitadel identifies the user; server-owned Trading data confirms that the authenticated owner may access that workspace.

## Default and custom-domain access
Every workspace must be reachable through the Mkety-hosted Trading product, with `trade.mkety.com` as the canonical product entry point.

An enterprise customer may optionally attach a hostname they control, for example `trade.starpipsforex.com`, using the existing Cloudflare for SaaS capability.

Both the Mkety hostname and a verified customer hostname resolve to the same internal Trading workspace and the same authentication/authorization boundary. A custom domain must never create a second workspace, second identity silo, or duplicated backend.

Target flow:

`trade.mkety.com OR verified customer hostname -> Cloudflare for SaaS -> Trading app -> resolve hostname to workspace -> Zitadel authentication -> owner/workspace authorization -> same Trading workspace`.

Custom domains are primarily branded routing. Additional white-label complexity is out of scope unless later required by a real customer.

## Mkety product isolation
Mkety identity may be shared across products, but runtime/data-plane failures must remain isolated:

- MKSaaS runtime/database failure must not stop Trading.
- Trading runtime/database failure must not affect MKSaaS.
- Trading-only customers must not need access to MKSaaS.
- A user entitled to multiple Mkety products may reuse the same identity.

## V1 non-goals
Do not add these pre-production unless real evidence proves they are required:

- complex teams or departments;
- multi-level workspace roles;
- per-customer Zitadel projects;
- separate Trading identity provider;
- separate backend per custom hostname;
- speculative white-label administration;
- architecture or acceptance tooling that does not fix a demonstrated CI/staging/demo blocker.

## Production principle
The architecture is now locked. The remaining work is operational: real staging, required runtime configuration, shared Mkety Zitadel setup, optional hostname mapping, real Telegram and demo-broker integrations, actual E2E, recovery checks, shadow, demo soak, then separately approved tiny live.

Real-money execution remains forbidden until a separate explicit owner approval provides exact financial limits and kill/rollback controls.
