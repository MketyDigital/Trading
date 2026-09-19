# Private Repository Operations

## Goal

Keep `MketyDigital/Trading` permanently private without changing the production trading architecture.

## Current readiness

- GitHub Actions use the repository-scoped `GITHUB_TOKEN` / `actions/checkout`, which continues to work when the repository is private.
- No runtime dependency on `raw.githubusercontent.com/MketyDigital/Trading`, public GitHub release downloads, or anonymous `git clone` of this repository was found in the repository scan.
- Cloudflare Worker deployment is GitHub Actions driven and does not require the repository to be public.
- The OCI gateway currently serving production is the authenticated private-source Coolify application `wp23orxgfa9py7giponnvcjt` (`Cbot Tcp gateway private`).
- OCI Coolify uses authenticated GitHub App source `mkety-github` for organization `MketyDigital`, source id `1`.
- Production repository source is `MketyDigital/Trading`, branch `main`, Docker Compose `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`.
- The previous public-source application `p9xqtqpbljnggchy36mzd7a0` is stopped and retained only as short-term rollback while the repository remains public.
- Authenticated-source cutover, environment parity, gateway health, WebSocket checks and MT5 session reconnection have already passed. The remaining visibility task is the one-time GitHub public-to-private change after the agreed observation period, followed by private checkout/deploy acceptance.

## Required Coolify environment keys

Copy these from the current production gateway to the staged private-source gateway inside Coolify. Do not change values while copying.

- `ACME_EMAIL`
- `CBOT_COMMAND_TIMEOUT_MS`
- `CBOT_CONTROL_SECRET`
- `CBOT_PUBLIC_HOST`
- `CBOT_TOKEN_SIGNING_KEY`
- `CLOUDFLARE_DNS_API_TOKEN`
- `MT5_CONNECTOR_COMMAND_TIMEOUT_MS`

The OCI Cloudflare DNS API token intentionally differs from the retired Azure value and must remain the working OCI value.

## Completed authenticated-source cutover

The Coolify source cutover is complete. Production is already running `wp23orxgfa9py7giponnvcjt` from authenticated GitHub App source `mkety-github`; `/health`, `/v1/cbot`, `/v1/mt5`, environment parity and MT5 session reconnection were verified.

## Remaining private visibility sequence

1. Keep the repository public through the agreed live-observation period unless the owner explicitly changes that decision.
2. Immediately before the visibility flip, verify `wp23orxgfa9py7giponnvcjt` is healthy and authenticated connector sessions are current.
3. Change GitHub repository visibility once from public to private.
4. Trigger one no-code Coolify redeploy from the authenticated private source and verify health/WebSockets/sessions.
5. Verify the next normal GitHub Actions CI/deploy run succeeds while private.
6. Keep the repository private permanently; do not oscillate visibility for routine development.

## Rollback

If the authenticated-source gateway fails:

1. Stop `wp23orxgfa9py7giponnvcjt`.
2. Restart `p9xqtqpbljnggchy36mzd7a0`.
3. Verify health and authenticated connector sessions.
4. Do not alter DNS; both applications use the same OCI host/port and the rollback is application-level.

If the repository has already been made private, the old public-source Coolify application may not be able to perform a fresh clone/redeploy. Its existing stopped container/image remains only a short-term rollback resource. Revert GitHub visibility temporarily only as a last resort; the intended steady state is private.

## GitHub Free organization caveat

GitHub Free organizations support private repositories and GitHub Actions, but branch protection/rulesets are available for public repositories on GitHub Free and for private repositories on paid Pro/Team/Enterprise tiers. While the organization remains on Free, compensate with minimal write/admin membership, owner-controlled merges, and CI before merging.

## Self-hosted runner plan

A separate Ubuntu runner can be registered later at organization level for private repositories. Keep it isolated from production OCI services. Use labels such as `self-hosted, linux, x64, mkety-ci` and move lightweight CI/deploy jobs selectively; leave memory-heavy/browser/build jobs on GitHub-hosted runners if the 1 GiB Azure VM proves too small.
