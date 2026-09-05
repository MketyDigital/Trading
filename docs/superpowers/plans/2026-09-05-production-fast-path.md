# Trading Production Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the already-built Mkety Trading V1 from exact-head GREEN to production through the shortest safe staging/demo/live sequence without adding speculative architecture.

**Architecture:** Mkety Trading is one simple owner-controlled enterprise workspace per customer, sharing Mkety Zitadel identity while retaining an independent Trading runtime/data plane. `trade.mkety.com` is the default entry point; verified enterprise custom hostnames may map through Cloudflare for SaaS to the same workspace. Authentication/workspace access and broker execution remain separate controls.

**Tech Stack:** Cloudflare Workers/Queues/Durable Objects/Containers/Cloudflare for SaaS, Supabase Postgres, Zitadel OIDC, Telegram MTProto, MT5, cTrader, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-trading-enterprise-workspace-product-model-design.md`

## Global Constraints

- Active branch: `design/enterprise-trading-event-core`; never merge `main` without explicit owner instruction.
- No real-money broker execution without separate explicit final owner approval and exact financial limits.
- Keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`, `TRADINGVIEW_CERT_PROBE_ENABLED=false`, `TRADING_ACCESS_ENABLED=false`, and `BROKER_EXECUTION_ENABLED=false` until the relevant rollout step explicitly changes them.
- One enterprise customer = one simple Trading workspace = one owner with full workspace control.
- Do not build complex team/role/department management for V1.
- Custom hostname routing never grants authorization; server-side owner/workspace authorization remains mandatory.
- No new architecture/tooling unless a real CI/staging/demo defect proves it is required.

---

### Task 1: Lock current product/continuation state

**Files:**
- Modify: `AGENTS.md`
- Create: `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`

**Interfaces:**
- Consumes: approved product-model spec and verified current branch/CI/DB state.
- Produces: one concise operational source of truth and one rolling pickup record.

- [ ] Replace stale Gate-6 handoff language with the current exact-head GREEN state.
- [ ] Record the approved simple owner-workspace model and optional Cloudflare for SaaS custom hostname model.
- [ ] Record Supabase migrations through Trading `0012` as applied/verified.
- [ ] Record the exact next production action and safety state.
- [ ] Commit documentation-only changes on the design branch.

### Task 2: Prove Cloudflare staging target before deployment

**Files:**
- Inspect: `.github/workflows/cloudflare-staging-gate.yml`
- Inspect: `cloudflare-v2/wrangler.toml`
- Inspect: `cloudflare-v2/wrangler.free.toml`
- Modify only if inspection proves target isolation is ambiguous or unsafe.

**Interfaces:**
- Consumes: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` in GitHub environment `staging`.
- Produces: verified staging Worker target/account identity with no production mutation.

- [ ] Re-fetch exact branch head immediately before any external action.
- [ ] Run existing Cloudflare staging workflow in `inspect` mode only.
- [ ] Verify `wrangler whoami`, target worker/deployment identity and dry-run output.
- [ ] If `mkety-copier-engine` is not proven to be an isolated staging target, make the smallest config change necessary to create/use an explicit staging Worker name; do not redesign deployment architecture.
- [ ] Re-run ordinary CI/dry-run after any config change.
- [ ] Update `PRODUCTION_FAST_PATH_HANDOFF.md` with exact run/job/result.

### Task 3: Complete minimum staging runtime configuration

**Files:**
- Inspect: `cloudflare-v2/src/config/staging_readiness.js`
- Configure external environment only; do not commit secrets.

**Interfaces:**
- Consumes: Supabase project `Mkety Digital`, Cloudflare staging Worker, later Mkety Zitadel project/app.
- Produces: staging health/readiness with required config present by name and no secret exposure.

- [ ] Set `SUPABASE_URL` for the connected Mkety Digital Supabase project in the staging runtime.
- [ ] Ensure a Supabase service-role secret is available to the deployed Worker under one accepted server-side name.
- [ ] Generate/store `TRADING_MASTER_KEY` securely; never print or commit it.
- [ ] Leave Zitadel values unset until the Mkety Trading project/app exists; do not fake issuer/audience/JWKS values.
- [ ] Deploy with all master access/execution flags false.
- [ ] Call `/api/v1/health`; require readiness output to expose only booleans/missing config names, never secret values.
- [ ] Update handoff with exact missing names and no secret material.

### Task 4: Create the minimal shared Mkety Zitadel Trading identity boundary

**External configuration:** Mkety Zitadel account/instance.

**Interfaces:**
- Produces: one Mkety Trading project/application boundary sharing the mother Mkety identity authority.

- [ ] Create one `Mkety Trading` Zitadel project, not one project per enterprise customer.
- [ ] Create the minimum OIDC application/API configuration required by the existing Trading auth code.
- [ ] Configure the exact issuer, audience, JWKS URL and project ID expected by `staging_readiness.js` / auth middleware.
- [ ] Keep authorization simple: authenticated Trading owner -> server-owned Trading workspace access.
- [ ] Do not build team/department role UX.
- [ ] Add Zitadel config values to staging secrets/vars without exposing them.
- [ ] Enable Trading access only for non-money-moving staging acceptance when existing safety requirements are satisfied; keep broker execution false.
- [ ] Verify a Trading-only owner can authenticate without an MKSaaS DB profile and cannot access another workspace.

### Task 5: Verify default hostname and optional enterprise custom hostname

**External configuration:** Cloudflare for SaaS.

**Interfaces:**
- Consumes: one existing Trading workspace and authenticated owner.
- Produces: `trade.mkety.com` plus one verified customer hostname resolving to the same workspace.

- [ ] Confirm `trade.mkety.com` reaches the Trading application.
- [ ] Add one staging/test customer hostname through the existing Cloudflare for SaaS mechanism.
- [ ] Store/resolve hostname -> workspace mapping server-side.
- [ ] Verify the custom hostname and Mkety hostname reach the same workspace.
- [ ] Verify hostname alone cannot bypass Zitadel or owner/workspace authorization.
- [ ] Defer branding/white-label expansion unless required for launch.

### Task 6: Connect real non-live integrations

**Interfaces:**
- Produces: real staging source/destination connectivity with no real-money execution.

- [ ] Connect one real Telegram source and one Telegram destination using existing MTProto tooling.
- [ ] Connect one MT5 demo account/source and one cTrader demo account/source using existing adapters.
- [ ] Verify source capture without creating live broker orders.
- [ ] Keep unrelated providers/accounts isolated when one integration is stopped or invalidated.
- [ ] Record only actual defects; fix them minimally with tests.

### Task 7: Run one real end-to-end demo lifecycle

**Interfaces:**
- Produces: verified real event lifecycle on demo infrastructure.

- [ ] Send one controlled source signal.
- [ ] Verify canonical Trading Event persistence and deterministic parse/normalization.
- [ ] Verify correlation/Trade State/planning.
- [ ] Verify Telegram fanout independently from broker fanout.
- [ ] Enable demo broker execution only under the existing explicit demo gate; never real-money execution.
- [ ] Verify demo broker result persistence, position-group/leg binding, management and close.
- [ ] Verify duplicate/replay does not create a duplicate broker action.
- [ ] Update handoff with exact evidence and defects.

### Task 8: Run only the material recovery checks

**Interfaces:**
- Produces: launch evidence for material failure modes.

- [ ] Restart/reconnect one source provider and verify recovery.
- [ ] Revoke/disable one source/account and verify only that affected path fails closed.
- [ ] Force one destination failure and verify successful siblings are not rolled back/resend.
- [ ] Exercise uncertain broker outcome reconciliation without blind retry.
- [ ] Exercise successful broker result -> state-binding repair without broker resend.
- [ ] Verify kill/rollback behavior.

### Task 9: Shadow and demo soak

**Interfaces:**
- Produces: production-like evidence without real money.

- [ ] Run shadow production with real inputs/decisions and broker execution disabled.
- [ ] Run dedicated demo execution long enough to exercise normal reconnect/recovery/management behavior.
- [ ] Fix only demonstrated defects.
- [ ] Require no unresolved severity-1/2 trading-safety defects before live consideration.

### Task 10: Tiny controlled live -> beta -> production

**Interfaces:**
- Consumes: separate explicit owner approval with exact financial limits.
- Produces: progressively expanded production use.

- [ ] Obtain explicit owner approval for real-money execution.
- [ ] Record exact max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols and kill/rollback procedure. Never invent defaults.
- [ ] Enable tiny live only within those limits.
- [ ] Review evidence before every expansion.
- [ ] Move to controlled beta, then general production only if tiny-live evidence is clean.
- [ ] Merge to `main` only with explicit owner instruction.

## Current verified starting point — 2026-09-05

- Branch was exact-head GREEN at `86c3991617bbe2a381106e8c3a62a6ecf135110b` before documentation lock-in.
- Ordinary CI run `33902795369`, job `101120562074`, succeeded; protected external Cloudflare jobs were skipped.
- Supabase project `Mkety Digital` is healthy.
- Trading migrations `0011_destination_delivery_retry_state` and `0012_trade_accounts_trading_workspace_fk` were applied successfully; live migration ledger is now through `0012`.
- `trade_accounts.workspace_id` now references `trading_workspace_access(id)` with `ON DELETE RESTRICT`; orphan prerequisite count was 0.
- Cloudflare API token/account ID and Supabase service-role key are reported stored in the GitHub `staging` environment.
- Mkety Zitadel account exists but the Trading project/application has not yet been created.
- No Cloudflare deployment, Zitadel mutation, Telegram external probe, demo broker action, master-fuse enablement, `main` merge or real-money execution has been performed in this fast-path session.
