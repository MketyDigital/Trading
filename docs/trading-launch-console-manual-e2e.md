# Mkety Trading Enterprise Portal — Manual E2E Runbook

## Customer entry model

The only customer-facing entry is `https://trade.mkety.com/`.

Customers do not manually open `/launch-console`, copy a workspace ID, or paste a bearer token. The root enterprise portal authenticates once, stores the short-lived Trading session in the browser, and opens the internal workspace/launch views automatically.

Two tenant authentication methods are supported by architecture:

1. **Access-code authentication (active now):** the customer enters the Mkety-issued access code and owner email at `trade.mkety.com`; Trading validates the code against Supabase and creates a short-lived local Trading bearer.
2. **Mkety signed authentication (alternate path):** when `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, and `MKETY_ACCESS_JWKS_URL` are configured, a valid Mkety-signed Trading assertion can authenticate the same tenant.

Both methods converge on the same Trading-owned Supabase workspace, membership and entitlement checks. They must never create parallel customer workspaces or duplicate authorization models.

`/mkety-admin/access-codes` is a separate Mkety-staff surface and is not part of the tenant session.

## Safety gates

Before any test:

- `BROKER_EXECUTION_ENABLED=false`.
- Do not use real broker credentials or authorize live-money execution.
- Never paste Telegram account credentials into External VM MTProto setup. External VM is handoff-only.
- Hosted Cloudflare Container/DO MTProto credentials are submitted only through the protected source API and must never be returned by list/read APIs.

## 1. Create an enterprise access code — Mkety staff

Open `/mkety-admin/access-codes` as authorized Mkety staff.

Choose one preset or a custom capability combination:

- **Trading Only** — trading execution destination available; Telegram, custom subdomain and custom hostname unavailable.
- **Trading + Telegram** — trading execution and Telegram destinations available; custom subdomain and hostname unavailable.
- **Full Access** — trading execution, Telegram, custom subdomain and custom hostname available.
- **Custom** — independently toggle the four capabilities.

Create the code and copy the plaintext value immediately. It is shown once. Listing and revocation never return plaintext or a code hash.

## 2. Customer signs in at trade.mkety.com

Open `https://trade.mkety.com/`.

Enter:

- enterprise access code;
- owner email;
- optional owner name;
- optional workspace display name.

Select **Continue with access code**.

Expected:

- the portal calls `POST /api/v1/access/redeem` internally;
- the customer is not shown or asked to copy a bearer token;
- the customer is not asked to copy a workspace UUID;
- one shared browser session is established automatically;
- the same session is used by the workspace and launch views;
- the workspace and safe entitlements are displayed;
- `brokerExecutionEnabled` remains `false`;
- live execution is never granted by an access code.

Reload the page and verify the active short-lived session restores automatically. Sign out and verify the browser session is cleared.

## 3. Verify entitlement-aware portal controls

Use the capabilities selected for the access code.

Expected UI and server behavior:

- `audit_only` remains available;
- Telegram destination controls are available only when `telegramDestination=true`;
- broker-account/internal-webhook destination controls are available only when `tradingExecutionDestination=true`;
- custom-hostname controls are hidden when `customHostname=false`;
- UI filtering is convenience only — server-side entitlement checks remain authoritative;
- broker destination records may be configured when entitled but cannot execute while the global broker fuse is off.

## 4. Create a source

From the authenticated enterprise workspace choose one test path.

### Fast signed API path

Create `custom_signed_api`. Copy its one-time signing secret when created. Use the source-event/webhook contract to send a controlled signal.

### External VM MTProto

Create `external_mtproto` without Telegram API/session credentials.

Expected:

- source is created with no provider credential configured;
- Telegram API/session credentials are rejected if supplied;
- credential replacement is unavailable for this provider;
- the VM/userbot sends signed source events to Mkety; Telegram login remains entirely on the VM.

### Cloudflare Container/DO MTProto

Create `cloudflare_container_mtproto` or `cloudflare_do_mtproto` using protected credential submission.

Expected:

- provider credentials are encrypted server-side;
- API responses expose only credential-configured booleans;
- raw credentials/ciphertext never appear in browser responses;
- runtime readiness/recovery is handled by the Mkety-hosted MTProto runtime.

## 5. Create destinations

Expected entitlement behavior for access-code-provisioned workspaces:

- `audit_only` is always allowed;
- `telegram` requires `telegramDestination=true`;
- `broker_account` and `internal_webhook` require `tradingExecutionDestination=true`;
- restricted destination creation, mutation, enable/disable, credential replacement and route targeting return an entitlement error;
- broker destination records can be configured but cannot execute because the global broker fuse remains off.

For Telegram, submit the destination credential only through the protected destination form/API. Verify list/read responses show only `credentialConfigured`.

## 6. Configure formatting

Create a template using one mode:

- `none`
- `clean`
- `template`
- `ai_then_fallback`

For AI formatting tests, deliberately induce one provider failure/timeout and confirm deterministic fallback still preserves canonical symbol, side, order type, entry, stop loss and take-profit values.

## 7. Create source-to-destination routes

Create one or more workspace-scoped routes from the source to permitted destinations.

Verify:

- disabled destinations do not deliver;
- a restricted destination cannot be targeted by a new route for an access-code workspace;
- no payload-supplied workspace/destination hint overrides persisted route authority.

## 8. Send a test signal

Use a deterministic demo-only signal with known symbol, side, entry, stop and take-profit values.

Expected pipeline:

1. source identity/signature is verified;
2. duplicate reservation/idempotency is applied;
3. canonical signal is parsed;
4. formatting is applied without semantic drift;
5. persisted routes are resolved;
6. destination delivery is attempted;
7. audit/operations records are written;
8. any broker execution attempt remains blocked by the global fuse.

## 9. Verify Telegram delivery

When the access code grants Telegram and destination credentials are valid, verify the formatted message reaches the configured Telegram target once.

Resend the same idempotent event and confirm the system does not produce an unintended duplicate delivery.

## 10. Verify operations and audit

Check the portal's operations/audit controls, backed by:

- `GET /api/v1/admin/operations`
- `GET /api/v1/admin/events/{eventId}/audit`

Confirm source receive, parse, route, formatting, destination delivery/retry and broker-block records are visible without raw credentials.

## 11. Verify hostname capability

For an access-code-provisioned workspace without `customHostname`, hostname controls should not be presented and `/api/v1/admin/hostnames` must still return `TRADING_ENTITLEMENT_REQUIRED` before touching the hostname store.

For a code with `customHostname=true`, continue only if `TRADING_CUSTOM_HOSTNAMES_ENABLED=true` and Cloudflare hostname provider configuration is intentionally enabled. DNS/customer production changes require separate authorization.

## 12. Verify alternate Mkety authentication boundary

When central Mkety auth is configured, verify that a Mkety-signed Trading bearer enters the same workspace authorization path and still requires the exact enabled Trading workspace and membership in Supabase.

The access-code method must continue to work independently. Enabling central auth must not disable, duplicate, migrate or fork access-code workspaces.

## 13. Final acceptance checklist

- Customer uses only `trade.mkety.com` for normal access.
- Access-code login requires no bearer/workspace copying.
- One tenant session spans workspace and launch features.
- Session survives ordinary redeployment while the signing root remains unchanged.
- Sign out clears the tenant browser session.
- All four capability switches behave independently in UI and server authorization.
- External VM MTProto has no Telegram credential path.
- Hosted MTProto stores credentials encrypted and never returns them.
- Telegram destination delivery works when entitled/configured.
- Restricted destinations and hostnames are rejected server-side.
- AI formatting cannot alter canonical trade semantics.
- Source-to-destination routing is workspace-scoped.
- Audit shows the complete event path.
- Mkety staff admin remains isolated from tenant authentication.
- Access-code auth and Mkety-signed auth converge on one Supabase authorization model.
- `BROKER_EXECUTION_ENABLED=false` throughout.
- No real-money execution occurs.
