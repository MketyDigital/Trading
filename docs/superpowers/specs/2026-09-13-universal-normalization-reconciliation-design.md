# Mkety V1 Universal Signal Normalization, AI Validation, Broker Reconciliation, and MT5 Auto-Sync Design

Date: 2026-09-13
Status: Approved design captured for implementation planning
Scope: cTrader Direct/Open API, cTrader cBot path, MT5 Connector, legacy MT5 bridge compatibility, Telegram/external webhook inputs, broker-state reconciliation, customer Connections UI

## 1. Objective

Mkety must execute trading instructions reliably across all supported market families without depending on symbol-specific parsing hacks. The execution pipeline must tolerate normal human formatting variation, safely repair only unambiguous numeric formatting mistakes, use AI as a bounded interpretation/validation assistant, and always preserve broker-authoritative state so follow-up management commands can target the correct positions.

The same canonical rules apply to cTrader and MT5. Broker adapters may translate symbols/volumes differently, but interpretation, correlation, execution intent, state identity, idempotency, and safety behavior are shared.

## 2. Supported market families

Normalization and routing must be market-wide and broker-catalog-driven, covering at minimum:

- FX pairs: EURUSD, GBPUSD, USDJPY, EUR/GBP, broker suffix/prefix variants, and other catalog-supported currency pairs.
- Metals: XAUUSD/GOLD/XAU, XAGUSD/SILVER/XAG, and broker variants.
- Crypto CFDs/spot-style broker symbols: BTCUSD/BTC/BITCOIN, ETHUSD/ETH/ETHER/ETHEREUM, and catalog-supported crypto pairs.
- Equity/index CFDs: US30/DJ30/DOW, NAS100/USTEC/US100/NASDAQ, SPX500/US500, GER40/DAX40, UK100/FTSE, JP225/NIKKEI, HK50/HSI, and catalog variants.
- Commodities: USOIL/WTI, UKOIL/BRENT, and other broker catalog instruments.
- Deriv synthetic markets: Volatility indices, Volatility (1s) variants, Boom, Crash, Step, Jump and other Deriv catalog-supported synthetic instruments.
- Additional future instruments must resolve through destination account symbol catalogs rather than requiring parser rewrites when a new tradable symbol appears.

Aliases are canonicalized first, then resolved to the destination account's actual broker symbol. Prefixes, suffixes and customer-defined aliases are supported. Ambiguous symbol matches fail closed.

## 3. Universal numeric normalization

Mkety must parse prices as structured numeric tokens instead of using decimal-only regex fragments.

Accepted common forms include:

- `77400.54`
- `77,400.54`
- `77 400.54`
- `77400`
- `77,400`
- `77010.81-77140.80`
- `77,010.81 - 77,140.80`
- `(77,010.81-77,140.80)`
- `@77,010.81`
- `at 77,010.81`
- `Entry: 77,010.81`
- line-separated SL/TP values
- uppercase/lowercase labels and ordinary Telegram decoration

Clearly unambiguous separator typos may be repaired. Example: `77,610,00` is interpreted as `77,610.00` only when the token structure and instrument magnitude make that repair uniquely safe.

Mkety must never guess when multiple numeric interpretations are plausible. Ambiguous numeric input routes to AI review and/or NEEDS_REVIEW rather than broker execution.

The original raw token, normalized token, normalized numeric value, confidence, and any repair reason must be auditable.

## 4. Order semantics

Order type is controlled by explicit order language, not by the mere presence of a number or range.

Examples:

- `BTCUSD BUY` -> MARKET fast entry.
- `BTCUSD BUY 77010` -> MARKET with reference/entry context.
- `BTCUSD BUY 77010-77140` -> MARKET with entry-zone context.
- `BUY LIMIT BTCUSD 76000` -> LIMIT.
- `SELL LIMIT XAUUSD 3660` -> LIMIT.
- `BUY STOP EURUSD 1.2050` -> STOP.
- `SELL STOP BTCUSD 75000` -> STOP.
- Explicit STOP LIMIT remains STOP_LIMIT where broker support exists.

A reference entry/range on a MARKET signal must not silently become a pending order.

## 5. Hybrid deterministic + AI interpretation architecture

### 5.1 Deterministic fast path

Clear signals are handled without AI for low latency:

1. Normalize text labels and punctuation.
2. Extract side/order language.
3. Normalize symbol aliases.
4. Parse structured numeric tokens.
5. Build candidate canonical intent.
6. Validate candidate against deterministic signal rules and broker/account metadata.
7. Execute only when confidence is high and all safety checks pass.

Examples that should normally bypass AI:

- `BUY XAUUSD`
- `BTCUSD sell`
- `SELL EURUSD 1.1860 SL 1.1900 TP 1.1800`
- well-formed Deriv synthetic signals.

### 5.2 AI-assisted path

AI is invoked quickly when deterministic confidence is insufficient, including:

- malformed separators,
- unusual natural-language ordering,
- nonstandard but recognizable aliases,
- unclear label placement,
- follow-up wording that is semantically clear to a human but not safely classified by deterministic rules,
- obvious typo candidates such as duplicated separators,
- presentation/rebranding tasks.

AI returns a structured candidate only. AI cannot directly authorize execution.

The deterministic validator must independently approve:

- symbol canonicalization,
- destination broker symbol mapping,
- side,
- order type,
- entry/reference range,
- stop loss,
- take profits,
- price magnitude/precision,
- basic directional sanity,
- broker digits/tick size,
- lot/volume rules,
- correlation target,
- account safety/risk controls.

If AI and deterministic interpretation disagree materially, fail closed to NEEDS_REVIEW.

AI must never invent a missing price, symbol, side, or management target solely to make a signal executable.

## 6. Price and signal sanity checks

Validation uses both canonical logic and broker metadata where available.

Examples:

- reject values whose magnitude is inconsistent with the resolved instrument/catalog context unless explicitly supported;
- validate broker tick size/digits and price precision;
- detect impossible or suspicious SL/TP relationships;
- detect malformed ranges where min/max collapse or scale differs drastically;
- preserve multiple TPs in input order/target index;
- do not reject valid unconventional strategies merely because a TP is unusual; only enforce deterministic correctness and configured risk/safety policy.

For risk-sized accounts, broker-authoritative risk calculations remain trade-level and are distributed across TP legs. For FIXED_LOTS, configured fixed lot means fixed lot per TP leg.

## 7. Fast-entry lifecycle and multi-TP completion

Approved contract:

- A fast signal such as `BUY BTCUSD` may immediately open one configured fixed-lot position.
- That position is leg 1 of the future completed signal.
- If a later safely correlated complete signal contains N take-profit targets, the final position group contains exactly N legs total.
- Existing fast leg becomes TP1 via modification when possible.
- Only N-1 missing legs are opened.
- Never create fast leg + N new TP legs.

Example at fixed lot 0.10:

- Fast message opens 0.10.
- Later signal contains TP1/TP2/TP3.
- Existing 0.10 becomes TP1.
- Open two new 0.10 legs for TP2 and TP3.
- Final total: three positions of 0.10 each.

This behavior must be identical on cTrader and MT5.

## 8. Durable broker state and reconciliation

Broker execution success and Mkety state persistence are separate steps and both must be represented explicitly.

Every successful broker OPEN must persist or recover:

- workspace ID,
- trade account ID,
- source event IDs,
- position group ID,
- stable leg ID,
- target index,
- canonical symbol,
- actual broker symbol,
- side,
- order type,
- lots/volume,
- SL/TP,
- broker position ID,
- broker order ID,
- fill price,
- execution timestamp/status.

If broker execution succeeds but state binding fails:

- delivery cannot be treated as fully complete from a lifecycle perspective;
- mark explicit state-binding pending/reconciliation state;
- do not resend the broker OPEN merely to repair state;
- repair by using the successful broker response first;
- if necessary query broker-authoritative open positions/orders using idempotency/client IDs, labels, symbol/side/account context and bounded time matching;
- once uniquely matched, bind state without opening another order;
- ambiguous reconciliation fails closed for management operations.

Reconciliation applies to both cTrader and MT5.

## 9. Follow-up and management correlation

Correlation priority:

1. Telegram reply/reference or explicit source-native reference.
2. Explicit symbol + direction matching one compatible incomplete group in the same workspace/source/account context.
3. Explicit symbol for management, matching one eligible group.
4. Unique contextual same-source match within bounded recency.
5. Ambiguous -> NEEDS_REVIEW, no broker action.

Never target the latest trade globally.

Examples supported across all market families:

- `close gold`
- `BTCUSD close half`
- `move V75 SL to BE`
- `risk free gold`
- `cancel NAS100 pending`
- `move SL to 3650`
- `change TP to 3700`
- `TP1 hit`
- `hold`
- `keep running`

Conditional/informational wording does not execute, e.g. `maybe close`, `consider BE`, `close if it reverses`.

Bare management commands only auto-target when exactly one safe eligible group exists in the same source context.

## 10. Broker parity

### cTrader

Applies to Direct/Open API and cBot execution paths:

- market/pending open,
- multi-TP legs,
- modify SL/TP,
- BE,
- partial/full close,
- pending cancel,
- state binding,
- uncertain-response reconciliation,
- idempotency.

### MT5

Applies to outbound MT5 Connector and keeps legacy bridge compatibility:

- market/pending open,
- broker `order_check`,
- volume min/max/step,
- symbol catalog resolution,
- multi-TP legs,
- SL/TP modification,
- BE,
- partial/full close,
- pending cancellation,
- uncertain-result reconciliation,
- replay/idempotency.

No semantic feature should exist only on cTrader unless the broker platform genuinely cannot represent it.

## 11. MT5 pairing and customer UX

Current defect: customer-facing copy promises `Sync MT5 identity`, but production UI may not render the button because the injection logic depends on fragile card text matching.

Target customer experience:

1. Customer creates one MT5 Connector pairing row.
2. Customer downloads and starts `MketyMT5Connector.exe` on the Windows machine running a logged-in MT5 terminal.
3. Customer pastes one-time token once.
4. Connector establishes gateway session and sends terminal identity/catalog.
5. Mkety automatically syncs identity when the gateway reports it.
6. Frontend reflects status without requiring a hidden/manual action:
   - Awaiting connector
   - Connected
   - actual account number
   - broker/server
   - Demo/Live
   - Trading Off/On
7. A manual `Retry identity sync` control may exist only as a recovery action.
8. Duplicate pending rows can be safely identified and removed/cancelled by the customer without affecting the connected row.
9. Pairing failure/status must be visible instead of silently closing and leaving `pending:` forever.

New MT5 accounts remain execution-disabled and live-disabled until explicitly enabled after verified identity.

## 12. Idempotency and duplicate protection

For each source event/account/leg/action, broker execution uses stable idempotency identity.

Requirements:

- duplicate Telegram delivery/edit/retry must not create duplicate broker orders;
- retries after uncertain broker response reconcile before resending;
- state-repair retry must never resubmit an already-filled OPEN;
- complete-signal expansion must detect already-existing target legs;
- MT5 connector reconnect/replay and cTrader retry paths must obey the same lifecycle contract.

## 13. AI presentation/rebranding separation

AI used for destination formatting or branding must not alter canonical trading semantics.

The execution intent is immutable after validation except through explicit lifecycle updates. Presentation AI may change wording/formatting only. Any AI-produced outbound signal must be cross-checked against canonical intent before send.

## 14. Operations and audit visibility

Operations must show recent trading events and enough lifecycle status to explain what happened without exposing secrets.

For recent events expose safely:

- source/display identity,
- processing status,
- canonical symbol/side/order type,
- normalized numeric interpretation and repair flags where relevant,
- correlation result/reason,
- destination account/platform,
- broker delivery status,
- state-binding/reconciliation status,
- high-level broker error code,
- audit drilldown.

No credentials, pairing tokens, API keys, passwords, bearer headers, connector reconnect secrets or raw secret-bearing payloads may appear.

## 15. Safety boundaries

- Live-money execution remains OFF unless separately and explicitly authorized.
- Demo and live environments remain distinct.
- Kill switch/account execution gates are checked immediately before broker dispatch.
- AI does not bypass any safety gate.
- Ambiguity fails closed.
- Broker/account symbol metadata is authoritative for executable symbol translation.
- Workspace/account/source isolation is mandatory for all correlation and management.

## 16. Required regression and acceptance matrix

Automated tests must cover at minimum:

### Numeric formats
- plain decimal,
- thousands comma + decimal,
- thousands spaces,
- no decimal,
- ranges with hyphen/en-dash/em-dash,
- parentheses,
- `@`/`at`/`entry`,
- typo separator repair such as `77,610,00`,
- ambiguous malformed numbers fail closed.

### Instruments
- major/minor FX,
- XAUUSD/GOLD,
- XAGUSD,
- BTCUSD/ETHUSD,
- major indices,
- oil,
- Deriv Volatility/Boom/Crash/Step/Jump examples,
- broker suffix/prefix catalog symbols.

### Orders
- MARKET with/without reference price,
- MARKET range,
- LIMIT,
- STOP,
- STOP_LIMIT where supported.

### Lifecycle
- fast entry,
- un-replied complete signal correlation,
- N TP completion gives exactly N final legs,
- fixed lot per TP,
- risk-sized allocation unchanged,
- BE,
- partial/full close,
- SL/TP modification,
- pending cancel,
- duplicate source events,
- simultaneous same-symbol signals,
- opposite-side same-symbol signals,
- stale followups,
- ambiguous management.

### Broker/state failures
- broker success + persistence failure,
- repair from broker response without duplicate execution,
- timeout/uncertain response reconciliation,
- reconnect/replay idempotency,
- cTrader parity,
- MT5 parity.

### MT5 onboarding
- one-time pairing,
- automatic identity sync,
- visible pending/connected/error state,
- duplicate pending row cleanup,
- no execution until verified/explicitly enabled.

### AI
- deterministic fast path bypasses AI for clear signals,
- AI repairs/interprets only bounded ambiguous formatting,
- AI output must pass deterministic validator,
- disagreement fails closed,
- AI outage does not corrupt clear deterministic execution,
- presentation AI cannot change canonical semantics.

## 17. Production acceptance sequence

After CI/security gates are green and changes are deployed:

1. Confirm live-money execution remains OFF.
2. Verify cTrader demo fast signal opens one leg and durable state binds.
3. Send compatible complete 3-TP signal without reply; verify exactly three total positions, not four.
4. Verify comma-formatted prices and typo-repair case parse correctly without broker BAD_STOPS.
5. Verify BE, partial close, SL/TP change, pending cancellation and full close.
6. Verify broker/state reconciliation by controlled simulated persistence failure without resending the order.
7. Pair one MT5 demo connector and confirm automatic identity sync/account catalog.
8. Repeat fast-entry + complete multi-TP + management lifecycle on MT5 demo.
9. Verify duplicate/reconnect/idempotency behavior on both platforms.
10. Verify Operations/audit explains each event and reconciliation step.

## 18. Success criteria

The work is complete only when:

- human signal formatting variations do not silently truncate prices;
- clear signals execute quickly without unnecessary AI latency;
- AI assists difficult interpretation but cannot directly authorize unsafe trades;
- cTrader and MT5 follow the same canonical lifecycle contract;
- fast-entry completion produces exactly the intended final leg count;
- broker-success/state-failure is recoverable without duplicate orders;
- MT5 pairing is understandable and observable from the customer frontend;
- all automated tests/security checks pass;
- controlled demo acceptance passes on both cTrader and MT5;
- live-money execution remains disabled unless separately authorized.
