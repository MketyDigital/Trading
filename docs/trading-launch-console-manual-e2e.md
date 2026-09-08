# Mkety Trading Launch Console — Manual E2E Runbook

## Safety gates

Before any test:

- `BROKER_EXECUTION_ENABLED=false`.
- Do not use real broker credentials or authorize live-money execution.
- Migration `0015_trading_destinations_templates_routes.sql` must be applied only after the branch is approved for deployment.
- Never paste Telegram account credentials into External VM MTProto setup. External VM is handoff-only.
- Hosted Cloudflare Container/DO MTProto credentials are submitted only through the protected source API and must never be returned by list/read APIs.

## 1. Create an enterprise access code

Open `/mkety-admin/access-codes` as Mkety staff.

Enter the staff secret for the current page session, then choose one preset or a custom capability combination:

- **Trading Only** — trading execution destination available; Telegram, custom subdomain and custom hostname unavailable.
- **Trading + Telegram** — trading execution and Telegram destinations available; custom subdomain and hostname unavailable.
- **Full Access** — trading execution, Telegram, custom subdomain and custom hostname available.
- **Custom** — independently toggle the four capabilities.

Create the code and copy the plaintext value immediately. It is shown once. Listing and revocation never return plaintext or a code hash.

## 2. Redeem the access code

Redeem through `POST /api/v1/access/redeem` with the intended owner email/workspace data.

Expected:

- response contains the exact workspace and safe entitlements;
- bearer is short-lived and workspace-bound;
- `brokerExecutionEnabled` is `false`;
- a requested subdomain is rejected unless `customSubdomain=true`;
- live execution is never granted by the access code.

## 3. Connect the enterprise launch console

Open `/launch-console` and provide:

- the redeemed workspace ID;
- the short-lived Trading bearer.

Verify `BROKER_EXECUTION_ENABLED=false` is visible before continuing.

## 4. Create a source

Choose one test path.

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

Use the access-code capability selected in step 1.

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

Use a deterministic test signal with known values, for example a synthetic/demo-only signal containing symbol, side, entry, stop and take profits.

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

When the access code grants Telegram and the destination credentials are valid, verify the formatted message reaches the configured Telegram target once.

Then resend the same idempotent event and confirm the system does not produce an unintended duplicate delivery.

## 10. Verify operations and audit

Check:

- `GET /api/v1/admin/operations`
- `GET /api/v1/admin/events/{eventId}/audit`

Confirm source receive, parse, route, formatting, destination delivery/retry and broker-block records are visible without raw credentials.

## 11. Verify hostname capability

For an access-code-provisioned workspace without `customHostname`, `/api/v1/admin/hostnames` must return `TRADING_ENTITLEMENT_REQUIRED` before touching the hostname store.

For a code with `customHostname=true`, continue only if `TRADING_CUSTOM_HOSTNAMES_ENABLED=true` and Cloudflare hostname provider configuration is intentionally enabled. DNS/customer production changes require separate authorization.

## 12. Final acceptance checklist

- Access code create/list/revoke works and plaintext is shown once only.
- All four capability switches behave independently.
- External VM MTProto has no Telegram credential path.
- Hosted MTProto stores credentials encrypted and never returns them.
- Telegram destination delivery works when entitled/configured.
- Restricted destinations and hostnames are rejected server-side.
- AI formatting cannot alter canonical trade semantics.
- Source-to-destination routing is workspace-scoped.
- Audit shows the complete event path.
- `BROKER_EXECUTION_ENABLED=false` throughout.
- No real-money execution occurs.
