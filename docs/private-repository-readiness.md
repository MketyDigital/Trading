# Private Repository Readiness

This repository is safe to change from public to private without changing the deployed Mkety Trading production runtime, provided the checklist below is followed.

## Production is not coupled to public GitHub visibility

- Production runs from the deployed Cloudflare Worker and Supabase services, not from source files fetched from GitHub at request time.
- Production deployment uses `actions/checkout` inside GitHub Actions. Checkout is authenticated with GitHub's workflow token, so it continues to work when the repository is private.
- Repository searches found no runtime dependency on `raw.githubusercontent.com`, GitHub Pages (`github.io`), or Git-based npm dependencies from this repository.
- GitHub Pages is not enabled for this repository.
- The Node package manifests use normal registry packages (`@mtcute/web`, `@supabase/supabase-js`, and `wrangler`) rather than packages fetched from this repository's public URL.
- Production secrets remain GitHub Actions/environment secrets and are not stored in the repository.

Changing repository visibility therefore does not undeploy, restart, or otherwise disconnect the already deployed Cloudflare Worker.

## GitHub Free private-repository considerations

GitHub Free private repositories have a monthly GitHub-hosted Actions allowance rather than the effectively unmetered standard-runner usage available to public repositories. Keep production E2E release-driven and avoid unnecessary manual reruns. The production frontend screenshots use short artifact retention to limit storage use.

GitHub CodeQL/code scanning that is available for a public repository is not available for a private repository on GitHub Free. Private CodeQL/code scanning requires an eligible paid organization plan with GitHub Code Security enabled. Mkety Trading production deployment must therefore never depend on a CodeQL check completing. Existing application tests, production health checks, browser E2E, and broker-safety gates remain the required free-private-compatible release protections.

## Checklist before changing visibility

1. Confirm `Production Cloudflare Deploy` and `Production Frontend E2E` are green on the current `main` revision.
2. Confirm the production runtime controls still report:
   - broker deployment capability available;
   - persisted owner broker switch OFF;
   - effective broker execution BLOCKED.
3. In GitHub Settings, confirm Actions is enabled for the repository and the organization still permits the actions used by this repository.
4. Confirm repository/environment secrets used by production remain configured. Do not rotate or copy secret values as part of a visibility change.
5. Check branch protection/status-check settings manually. Remove any required CodeQL/code-scanning status check before switching to GitHub Free private if that check would become unavailable. Do not remove the normal Trading test/release safety expectations.
6. Review GitHub Actions usage periodically. GitHub Free for organizations currently includes 2,000 GitHub-hosted Actions minutes per month and 500 MB of artifact storage; usage can be blocked when the included quota is exhausted if no paid overage is configured.
7. Change repository visibility to private.
8. After the visibility change, run one normal Trading CI workflow and one guarded production deployment/E2E cycle before making unrelated product changes. The owner broker switch must remain OFF during this verification.

## Things that must remain private-compatible

When adding future dependencies or deployment steps:

- Do not make production fetch executable code/config from this repository through unauthenticated public GitHub URLs.
- Do not use GitHub Pages as a production dependency for `trade.mkety.com`.
- Do not add npm/pip dependencies that rely on anonymous access to this repository.
- Use authenticated `actions/checkout` or another authenticated GitHub mechanism when a workflow needs repository content.
- Keep Cloudflare/Supabase credentials in protected secrets, never source control.
- Do not make paid GitHub security products a required production deployment gate unless the organization intentionally upgrades and accepts that dependency.

## Current acceptance baseline

Before this document was added, the production acceptance sequence verified the real customer frontend in Chromium, desktop/mobile rendering, access-code creation/redemption, entitlement-aware controls, destination/template writes, returning-session restoration, durable logout, staff API protection, disposable-fixture cleanup, production health, and the dual broker safety gates with effective broker execution blocked.
