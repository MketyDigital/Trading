# Current Development Handoff

Read root `AGENTS.md` first for production boundaries and the deployed Trading V1 baseline.

The active continuation is **draft PR #13** on branch `fix/returning-auth-admin-runtime-controls`.

Authoritative active-development handoff:

`docs/superpowers/handoffs/2026-09-08-returning-auth-admin-runtime-controls-handoff.md`

Implementation plan:

`docs/superpowers/plans/2026-09-08-returning-auth-admin-runtime-controls.md`

Important: the production baseline documented in `AGENTS.md` is PR #12. PR #13 is not production-ready until its current Worker/trading-core CI regression is fixed, the complete suites and CodeQL pass on the final head, migration `0017_trading_runtime_controls.sql` is applied, the persisted owner broker switch is verified OFF, the PR is merged, production is deployed, and post-deploy smoke checks pass.

Do not enable real-money broker execution during ordinary frontend acceptance.