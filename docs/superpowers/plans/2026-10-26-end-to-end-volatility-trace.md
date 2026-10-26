# End-to-End Volatility Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the production D1 diagnostic workflow to trace volatility events from source intake through final recorded broker and lifecycle outcome.

**Architecture:** Preserve the current SELECT-only workflow and add bounded queries over event, source/feed, route/destination/account, journal, delivery, follower, and position tables. Reports use stable pseudonymous ordinals and safe error fields; no trading workers are invoked.

**Tech Stack:** GitHub Actions, Node.js, Cloudflare D1 SQL.

**Spec:** [2026-10-26-end-to-end-volatility-trace-design.md](../specs/2026-10-26-end-to-end-volatility-trace-design.md)

## Global Constraints

- Do not replay or trigger past signals.
- Do not modify open, passed, or closed trades.
- Preserve future-only, additive changes.
- Keep all production D1 accesses in this workflow SELECT-only; require rows_written=0.
- Omit raw payloads, secrets, account IDs, and workspace IDs from the report.

## Review Focus

- Missing source-stage journal row while event exists: show an evidence gap, not a guessed root cause.
- No persisted event: include unlinked source-stage failures for the relevant source connections/time window.
- Feed-specific route scope: distinguish unselected feed routes from selected routes.
- Symbol filters: report filter outcome using the same allow/block rules as the worker.
- Followers: list follower account outcomes independently from parent destinations.

---

### Task 1: Extend read-only workflow report

**Files:**
- Modify: `.github/workflows/production-d1-readonly-demo-diagnostics.yml`

**Interfaces:**
- Consume: existing `window_hours` and `event_times_utc` inputs and configured production D1 binding.
- Produce: source/route mapping, stage timeline, destination delivery, and missing-handoff summaries in the existing workflow report.

- [ ] Preserve current query statements and rows-written guard.
- [ ] Add bounded queries for source/event identity, route/feed scope, destination/account/follower mapping, journal stage outcomes, deliveries, and linked legs.
- [ ] Ensure output fields are allowlisted/redacted; never select raw text or request/response payloads.
- [ ] Run the focused workflow for the Oct 26 timestamps and confirm its D1 metadata reports zero rows written.
- [ ] Review the generated report against the event/source/route/account mapping and capture missing evidence explicitly.