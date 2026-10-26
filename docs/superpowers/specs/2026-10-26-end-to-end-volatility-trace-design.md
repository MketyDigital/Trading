# End-to-End Volatility Execution Diagnostics

**Intent:** Trace each persisted volatility signal from its source connection/feed through route selection, destination/account planning, execution, connector, and recorded lifecycle outcomes so future failures can be localized.

**Goals:** Report source/event identifiers as stable privacy-safe ordinals; show source health, active/inactive route scope, destination state, broker account mapping, follower expansion, journal stage/status/error/retryability, delivery outcomes, and linked position-leg counts. Flag absent expected handoffs without treating optional or filtered stages as failures.

**Non-goals:** No trading behavior, database schema, credential, routing, retry, replay, reconciliation, or position changes. No raw signal text, payloads, credentials, broker account IDs, or workspace IDs in output.

**Approach:** Extend the existing Production D1 Read-only Demo Diagnostics workflow with bounded SELECT queries. Keep existing planning/execution summaries; add route configuration comparison, complete event-linked journal timeline, delivery rows, and unattached source-stage failures within the selected time window. Reuse its D1 binding, exact-timestamp filter, output redaction, and rows-written guard.

**Constraints:** Use the existing workflow's trusted main checkout and D1 binding verification. The new queries must be read-only and parameterized. Expected routes must follow current feed-specific/default route scoping and broker symbol-filter semantics; followers must be labeled separately. Missing evidence is reported as a gap, not a cause.