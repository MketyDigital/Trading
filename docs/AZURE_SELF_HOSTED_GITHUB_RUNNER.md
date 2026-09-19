# Azure Self-Hosted GitHub Runner Plan

## Objective

Provision a small isolated Ubuntu VM in Azure as an organization-level GitHub Actions runner for `MketyDigital`.

Required runner labels:

- `self-hosted`
- `linux`
- `x64`
- `mkety-ci`

Target VM posture: roughly 2 vCPU / 1 GiB RAM, Ubuntu LTS, minimal disk, no trading gateway services, no MT5/cTrader workloads, and no direct production role.

## Isolation rule

The runner must remain separate from the OCI production gateway and from Windows MT5 connector VPS machines. CI compromise or build load must not affect broker connectivity.

## Workload policy

Use the small runner only for lightweight repository tasks that benefit from a persistent private-repo executor. Keep browser-heavy, memory-heavy, Windows packaging, CodeQL, and large build/test jobs on GitHub-hosted runners unless measured resource usage proves the Azure runner can handle them reliably.

Do not move all workflows to `mkety-ci` by default. Migrate jobs selectively using `runs-on: [self-hosted, linux, x64, mkety-ci]` only after the runner has been observed stable.

## Registration scope

Register at the `MketyDigital` organization level so the runner can later serve authorized private repositories without being tied to the Trading repository.

Restrict repository access at the runner-group level when organization settings allow it.

## Security baseline

- Dedicated non-production VM and operating-system account.
- Automatic security updates.
- SSH key authentication; disable password SSH when practical.
- Minimal inbound network exposure.
- Do not copy broker credentials, MT5 credentials, Coolify secrets, Cloudflare tokens, or production runtime data onto the runner.
- GitHub runner service token/registration lifecycle only.
- Avoid Docker privileged mode unless a specific workflow needs it.
- Keep runner work directory disposable; secrets must come from GitHub Actions at job runtime.

## Acceptance

1. VM online and patched.
2. Runner registered at organization level with labels `self-hosted, linux, x64, mkety-ci`.
3. One harmless repository diagnostic job runs successfully on the runner.
4. Runner survives reboot and reconnects automatically through its normal system service.
5. No production trading service is listening on the runner.
6. Existing GitHub-hosted CI remains available as fallback.

## Private-repository relationship

The Trading repository is currently still PUBLIC during the agreed observation period, but it is private-ready. The runner is not required for the public-to-private cutover: GitHub Actions and the authenticated Coolify GitHub App already support private access. The runner is an independent CI-cost/control improvement and should not be coupled to production trading availability.
