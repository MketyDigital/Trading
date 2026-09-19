# Private Repository Operations

## Goal

Keep `MketyDigital/Trading` permanently private without changing the production trading architecture.

## Current readiness

- GitHub Actions use the repository-scoped `GITHUB_TOKEN` / `actions/checkout`, which continues to work when the repository is private.
- No runtime dependency on `raw.githubusercontent.com/MketyDigital/Trading`, public GitHub release downloads, or anonymous `git clone` of this repository was found in the repository scan.
- Cloudflare Worker deployment is GitHub Actions driven and does not require the repository to be public.
- The OCI gateway currently serving production is `p9xqtqpbljnggchy36mzd7a0`.
- OCI Coolify has an authenticated GitHub App source named `mkety-github` for the `MketyDigital` organization.
- A staged authenticated-source gateway application has been created:
  - name: `Cbot Tcp gateway private`
  - UUID: `wp23orxgfa9py7giponnvcjt`
  - repository: `MketyDigital/Trading`
  - branch: `main`
  - build pack: `dockercompose`
  - compose: `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`
  - Coolify source id: `1` (`mkety-github`)
- The staged private-source app must not replace production until its seven gateway environment variables exactly match the current production gateway and a controlled authenticated-source deploy passes health/WebSocket checks.

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

## Controlled source cutover

1. Confirm `wp23orxgfa9py7giponnvcjt` has exact production env parity.
2. Confirm the current public-source gateway remains healthy.
3. Stop the current gateway `p9xqtqpbljnggchy36mzd7a0` without Docker cleanup.
4. Deploy/start `wp23orxgfa9py7giponnvcjt`.
5. Verify:
   - `https://cbot.mkety.com:25345/health`
   - `wss://cbot.mkety.com:25345/v1/cbot`
   - `wss://cbot.mkety.com:25345/v1/mt5`
   - authenticated MT5/cTrader session registries
6. Keep the old application stopped as rollback until private-repository acceptance is complete.
7. Change GitHub repository visibility to private.
8. Trigger one no-code Coolify redeploy from the private source and verify health again. This proves the private GitHub App can clone after visibility changes.
9. Verify the next normal GitHub Actions CI/deploy run succeeds while private.

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
