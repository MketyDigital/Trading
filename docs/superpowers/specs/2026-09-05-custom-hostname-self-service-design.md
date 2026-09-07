# Trading Custom Hostname Self-Service Design

## Goal
Allow an authorized Trading workspace owner to provision and verify a customer vanity hostname without developer intervention while preserving the existing rule that hostname is routing context only, never authorization.

## External provider
Cloudflare for SaaS remains the custom-hostname provider. The server uses a narrowly scoped Cloudflare API token and zone ID. Browser clients never receive the API token.

Cloudflare hostname ownership and certificate validation are separate. A hostname becomes locally active only when Cloudflare reports both custom-hostname status `active` and SSL status `active`.

## Admin surface
Authorized workspace-scoped routes:
- `GET /api/v1/admin/hostnames` — list only this workspace's hostname records.
- `POST /api/v1/admin/hostnames` — validate hostname, create the Cloudflare custom hostname, persist a local `pending` record, and return safe DNS/validation instructions.
- `POST /api/v1/admin/hostnames/:id/verify` — re-read Cloudflare state for that exact persisted hostname and synchronize local state. It never trusts a hostname supplied by the caller for an existing ID.

Deletion/rotation is intentionally outside this first bounded slice; provisioning and verification close the current product gap without introducing broader lifecycle semantics.

## Configuration
Required server-side configuration:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

Missing configuration fails closed with a stable service-unavailable reason.

## Hostname validation
Input is normalized to lower-case DNS form and must be an exact non-wildcard hostname. Reject URLs, ports, paths, IP literals, trailing dots, whitespace, canonical Mkety Trading hosts, the configured CNAME target itself, and malformed DNS labels.

The hostname must remain globally unique in `trading_workspace_hostnames` as already enforced by migration 0013.

## Provisioning transaction
1. Authorize Mkety signed access and exact enabled Trading workspace membership through the existing V1 admin boundary.
2. Validate the requested hostname locally.
3. Create the Cloudflare custom hostname using DV with TXT certificate validation.
4. Insert the exact workspace-owned local record as `pending`.
5. If local persistence fails after Cloudflare creation, best-effort delete the just-created Cloudflare hostname to avoid an orphan and return a generic failure.
6. Return only safe provider state and DNS instructions: CNAME target, ownership-verification records, and SSL validation records. Never return Cloudflare credentials or raw provider error bodies.

## Verification
Verification resolves the local hostname row by `(workspace_id, id)`, then asks Cloudflare for that hostname's current state. Caller-supplied hostname/provider IDs are never authority.

Local status mapping:
- Cloudflare hostname `active` AND SSL `active` -> local `active`, set `verified_at` if absent.
- otherwise -> local `pending`, `verified_at = null`.

The existing resolver already requires local `status=active`, so an unverified hostname cannot become a routing authority merely by being provisioned.

## Safety
This feature does not:
- enable `TRADING_CUSTOM_HOSTNAMES_ENABLED`;
- change Mkety identity or membership authorization;
- enable Trading access or broker execution;
- deploy Cloudflare configuration;
- change fallback origins/CNAME-target DNS;
- merge to `main`.

## Testing
Required tests:
- malformed, wildcard, canonical and target hostname rejection;
- exact-workspace create/list/verify scoping;
- provider credentials never enter API responses;
- create persists `pending` even if provider is already active until explicit verification sync;
- verification activates only when both hostname and SSL are active;
- failed verification remains pending;
- local insert failure triggers best-effort Cloudflare cleanup;
- missing Cloudflare configuration fails closed;
- existing hostname resolver and authorization tests remain unchanged.
