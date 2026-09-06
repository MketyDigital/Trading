# Trading V1 Frontend/API/Schema Audit

Status: PASS on the `fix/v1-frontend-sync-simulation` branch as of the Task 7 documentation pass.

This audit records the real Trading dashboard surface after the V1 frontend synchronization work. The purpose is to prevent future agents from reintroducing legacy `/api/admin/*` proxy routes, fake UI saves, caller-controlled simulation switches, or direct database-table CRUD from the browser.

## Global UI contract

Every protected dashboard request must use the V1 Trading admin contract:

- `Authorization: Bearer <Mkety Trading assertion>`
- `X-Mkety-Workspace-Id: <selected workspace>`
- `/api/v1/admin/*` endpoint paths only

The dashboard contract test asserts the rendered frontend does not reference retired routes:

- `/api/admin/data/proxy`
- `/api/admin/bot/authorize`
- `/api/admin/bank/decision`
- `/api/admin/listener/`
- `/api/webhook/process_signal`

The V1 admin router then authorizes each request through Mkety access verification, exact workspace selection, hostname checks, Trading workspace enablement, and exact Trading membership before dispatching to any resource handler.

## Authorization and workspace boundary

| Layer | Contract | Backend file | Result |
| --- | --- | --- | --- |
| Bearer assertion | `Authorization` header, Mkety access issuer/audience/JWKS | `src/security/mkety_access_assertion.js`, `src/http/v1_admin.js` | PASS |
| Workspace selector | `X-Mkety-Workspace-Id` required before workspace lookup | `src/http/v1_admin.js` | PASS |
| Hostname routing | Canonical hosts always allowed; custom hostnames only when enabled and exact workspace-bound | `src/security/trading_hostname_resolver.js`, `src/http/v1_admin.js` | PASS |
| Trading entitlement | `trading_workspace_access.trading_access_enabled` | `src/http/v1_admin.js` | PASS |
| Membership | Exact enabled subject/workspace membership | `src/security/trading_membership_store.js`, `src/http/v1_admin.js` | PASS |
| Permission | Role-specific `hasTradingPermission()` check per handler | `src/security/trading_permissions.js` | PASS |

## Frontend control matrix

| Dashboard area | Visible control/state | API endpoint | Method | Permission | Store/table touched | UI state after response | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth panel | Workspace ID + bearer token entry | Browser-local only | N/A | N/A | None | Stores selected workspace/token in browser state for V1 requests | PASS |
| Workspace overview | Load current workspace | `/api/v1/admin/workspace` | GET | `workspace.read` | `trading_workspace_access`, membership store | Shows workspace identity/access state | PASS |
| Members | List members | `/api/v1/admin/members` | GET | `members.read` | Trading membership store | Renders subjects, roles, enabled state | PASS |
| Members | Add/upsert member | `/api/v1/admin/members` | POST | `members.write` | Trading membership store | Refreshes canonical server member list | PASS |
| Members | Change role | `/api/v1/admin/members/{subject}/role` | POST | `members.write` | Trading membership store | Refreshes member row; protects last owner | PASS |
| Members | Enable member | `/api/v1/admin/members/{subject}/enable` | POST | `members.write` | Trading membership store | Refreshes enabled state | PASS |
| Members | Disable member | `/api/v1/admin/members/{subject}/disable` | POST | `members.write` | Trading membership store | Refreshes enabled state; protects last owner | PASS |
| Sources | List sources | `/api/v1/admin/sources` | GET | `sources.read` | `source_connections` | Renders source family/provider/default/health/credential status | PASS |
| Sources | Create source | `/api/v1/admin/sources` | POST | `sources.write` | `source_connections` | Refreshes canonical source list; one-time signing secret only where supported | PASS |
| Sources | Read source | `/api/v1/admin/sources/{sourceId}` | GET | `sources.read` | `source_connections` | Shows sanitized source state | PASS |
| Sources | Replace credentials | `/api/v1/admin/sources/{sourceId}/credentials` | PUT | `sources.write` | `source_connections.provider_secret_ciphertext` or source ingress secret | Refreshes source list; secrets are not re-displayed except one-time signing secret | PASS |
| Sources | Set default | `/api/v1/admin/sources/{sourceId}/default` | POST | `sources.write` | `trading_set_default_source` RPC / `source_connections` | Refreshes source list from server truth | PASS |
| Sources | Enable source | `/api/v1/admin/sources/{sourceId}/enable` | POST | `sources.write` | `source_connections.is_active` | Performs readiness check before activation, then refreshes | PASS |
| Sources | Disable source | `/api/v1/admin/sources/{sourceId}/disable` | POST | `sources.write` | `source_connections.is_active`, `is_default=false` | Refreshes disabled/default state | PASS |
| Accounts | List accounts | `/api/v1/admin/accounts` | GET | `accounts.read` | `trade_accounts` | Renders platform/account/active/execution/kill state | PASS |
| Accounts | Create account | `/api/v1/admin/accounts` | POST | `accounts.write` | `trade_accounts` | Creates inactive account with execution disabled and kill switch true | PASS |
| Accounts | Replace credentials | `/api/v1/admin/accounts/{accountId}/credentials` | PUT | `accounts.write` | `trade_accounts.credential_ciphertext` | Refreshes account state; secrets are never displayed | PASS |
| Accounts | Activate/deactivate account | `/api/v1/admin/accounts/{accountId}/active` | POST | `accounts.write` | `trade_accounts.is_active`; deactivation also disables execution | Refreshes account lifecycle state | PASS |
| Accounts | Enable/disable execution | `/api/v1/admin/accounts/{accountId}/execution` | POST | `accounts.write` | `trade_accounts.execution_enabled` | Refreshes account execution state; master broker fuse still controls real reachability | PASS |
| Accounts | Kill switch on/off | `/api/v1/admin/accounts/{accountId}/kill-switch` | POST | `accounts.write` | `trade_accounts.safety_policy.killSwitch` | Refreshes risk/kill state | PASS |
| Hostnames | List hostnames | `/api/v1/admin/hostnames` | GET | `hostnames.read` | `trading_workspace_hostnames` | Shows status and CNAME target if configured | PASS |
| Hostnames | Create custom hostname | `/api/v1/admin/hostnames` | POST | `hostnames.write` | Cloudflare custom-host provider + `trading_workspace_hostnames` | Creates pending hostname only when provider configuration exists | PASS |
| Hostnames | Verify custom hostname | `/api/v1/admin/hostnames/{hostnameId}/verify` | POST | `hostnames.write` | Cloudflare custom-host provider + `trading_workspace_hostnames.status/verified_at` | Refreshes verification status | PASS |
| Operations | Snapshot delivery/account safety state | `/api/v1/admin/operations` | GET | `operations.read` | `destination_deliveries`, `trade_accounts`, optional resilience source | Shows delivery counts, overdue retries, recent failures, blocked accounts | PASS |
| Event audit | Drill into one event | `/api/v1/admin/events/{eventId}/audit` | GET | `operations.read` | `trading_events`, `source_connections`, `position_groups`, `position_legs`, `destination_deliveries` | Shows sanitized event/source/group/leg/delivery evidence | PASS |
| Settings | Runtime/security configuration display | No write endpoint | N/A | N/A | None | Read-only explanation of deployment-owned auth/fuse/transport settings | PASS |

## Removed or blocked surfaces

| Surface | Previous risk | Current result | Status |
| --- | --- | --- | --- |
| Generic browser DB proxy | Browser could route arbitrary table CRUD through `/api/admin/data/proxy` | Not referenced by dashboard; legacy `/api/admin/*` routes intercepted by V1 wrapper | REMOVED |
| Telegram bot authorize shortcut | Legacy bot setup path not workspace-safe under V1 | Not referenced by dashboard | REMOVED |
| Bank decision/admin route | Non-Trading legacy SaaS admin surface | Not referenced by dashboard | REMOVED |
| Legacy signal webhook | Broker-capable unauthenticated legacy path | `/api/webhook/process_signal` returns retired response at V1 wrapper | REMOVED |
| Fake AI/settings save | UI could claim saved state with no backend contract | Settings surface is read-only | REMOVED |
| Browser-selected simulation | Caller could attempt to choose execution transport | Transport is deployment/env-owned only; dashboard cannot select it | BLOCKED |

## Backend schema/state mapping

| Backend concern | Primary persistence | Notes | Status |
| --- | --- | --- | --- |
| Workspace access | `trading_workspace_access` | Must be enabled before admin dispatch | PASS |
| Membership | Trading membership store / backing membership table | Exact subject and workspace must match assertion | PASS |
| Source connections | `source_connections` | Secrets encrypted server-side; public response sanitized | PASS |
| Broker accounts | `trade_accounts` | Accounts start inactive, execution disabled, kill switch true | PASS |
| Custom hostnames | `trading_workspace_hostnames` | Provider configuration required before create/verify | PASS |
| Event ingest/audit | `trading_events` | Audit is workspace-scoped and sanitized | PASS |
| Trade state | `position_groups`, `position_legs` | Event audit links direct and historical source event IDs | PASS |
| Delivery/idempotency | `destination_deliveries` plus production idempotency reservations | Operations and event audit expose sanitized status only | PASS |
| Resilience metrics | Optional injected resilience metrics source | Operations marks unavailable if not configured | PASS |

## Test coverage backing this audit

- `tests/v1_dashboard_contract.test.mjs` guards against retired frontend endpoints and requires V1 bearer/workspace headers.
- `tests/v1_dashboard_views.test.mjs` covers source/default/credential and account credential route usage plus canonical refresh behavior.
- `tests/v1_dashboard_operations.test.mjs` covers operations, event audit, account execution/kill-switch controls, and read-only settings.
- `tests/v1_admin_event_audit.test.mjs` proves event audit is exact-workspace scoped and sanitizes secrets/raw material.
- `tests/v1_full_stack_simulation.test.mjs` proves signed event ingest, simulation planning and safe execution-stage handoff without real broker dependency selection.
- `tests/v1_full_stack_simulation_idempotency_audit.test.mjs` proves duplicate events do not re-execute and simulated provider/account events remain visible through event audit.

## Remaining constraints

This audit does not claim external staging acceptance, real source connectivity, real broker connectivity, DNS/custom hostname mutation, or production promotion.

Real execution remains locked behind:

- `TRADING_ACCESS_ENABLED`
- `BROKER_EXECUTION_ENABLED`
- server-owned execution transport mode
- persisted source/account/workspace state
- risk/kill/exposure checks
- broker-authoritative symbol/risk/volume validation
- durable destination/order idempotency

## Task 7 conclusion

No unmapped frontend control requiring production code changes was found during this audit. The remaining work is Task 8 final verification, CodeQL/status review and handoff/AGENTS refresh.