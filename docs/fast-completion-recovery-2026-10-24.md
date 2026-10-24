# Fast/full volatility completion repair — 2026-10-24

## Deployment status
**NOT DEPLOYED.** Draft PR #222 adds guarded detection/correlation and regression coverage, but does not integrate broker-authoritative adoption/reconciliation into the production execution stage. Do not represent CI green as broker acceptance or merge automatically. Production runtime controls and unrelated settings remain unchanged.

## Incident timeline (Africa/Lagos WAT UTC+1)
- BUY V75 fast ~07:03 WAT (06:03 UTC); full ~07:13 WAT (06:13 UTC). Diagnostic run 40132730690 reports a volatility BUY full signal at 06:13:42 UTC with 3 TP targets, MARKET_CONTEXT_UNAVAILABLE on one planning path, and DEMO MT5 action failures around 06:13:56. Sanitized categories do not prove the exact symbol/broker ticket.
- V25 (1s) fast ~18:41 WAT (17:41 UTC); full ~18:46 WAT (17:46 UTC). Full signal at 17:46:26 UTC has SL + 3 TPs, with an EDIT_TARGET/NEEDS_REVIEW route and separate MARKET_CONTEXT_UNAVAILABLE path. Again exact tickets are unverified.
- Source: successful read-only D1 diagnostic run https://github.com/MketyDigital/Trading/actions/runs/40132730690.

## Required execution invariants
1. Reload persisted account/workspace route and broker authority immediately before actions; never turn LIVE on automatically.
2. Compare existing broker-bound positions and pending orders by ticket, account, exact platform symbol, direction, source/cohort, opening window and target; match ambiguity blocks auto-adoption.
3. Existing broker position -> MODIFY and manage. Genuinely confirmed absent position -> open once, using durable deterministic idempotency and broker post-response reconciliation. Unknown/outstanding order -> recheck; never blind retry.
4. Respect MT5 netting versus hedging and cTrader execution models. A netting position is not interchangeable with three hedged legs.
5. Maintain declared TP slot count. An already-passed/invalid TP can leave its leg open with valid broker SL, broker TP null, and logical TP preserved for later edit/reply and progressive management. Invalid SL cannot silently authorize an unprotected new open.
6. TP1 -> SL to break-even; TP2 -> prior TP1; TP3 -> TP2, while respecting broker stop/freeze levels and explicitly rejecting impossible individual modifications without blocking safe sibling updates.
7. Manual additions must be matched against ALL already claimed broker tickets, not merely current trade; no automatic order creation from a candidate-matching helper.

## Current branch coverage
- Pure read-only manual candidate matcher with strict source, account, symbol, ticket, time, target, and cross-group claimed-ticket screening.
- Edit correlation for a broker-bound fast starter whose incomplete flag drifted false while no TP protection was set.
- Missing middle target detection; preservation of SL-protected legs with TP placeholders in fast reconciliation.
- Related regression cases. CI #3411 passed as of October 24, but additional broker validation is required.

## Known blockers and evidence requirements
- Edited completions with additional TP legs are still refused by the generic EDIT_TARGET handler. Integrate broker-confirmed recovery path, rather than removing guard outright.
- Full-completion market context requires valid connector/account identity/symbol/tick. Allowlisted diagnostic codes help distinguish failures, but run 40132730690 does not contain enough broker detail to attribute the exact root cause of either incident.
- Repeated cTrader DEMO ACCOUNT_ACTION_FAILED needs structured gateway rejection categories.
- Candidate matcher is NOT wired into trade-state binding and execution; automatic recovery is NOT complete.
- D1 monitor uses due-time snapshots with 60s minimum and bounded pages, but regular observation writes may still be high. Measure live rows read/written and query plans before reworking the observation cursor or replication writes. Do not disable cursor updates, or overdue candidates could loop continuously.

## Safe release gate
- Newest commit CI green and regression suite green.
- Exact broker tickets and action outcomes reconciled in DEMO (including failed/time-out open and manual position adoption).
- D1 before/after query/rows read/write measurement with indexed due-only queries.
- Prove no duplicate orders or protection regression, verify cTrader and MT5 on DEMO.
- Keep LIVE disabled and main untouched unless controlled release criteria are met and reviewed.
