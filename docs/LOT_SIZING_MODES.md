# Lot sizing modes

Mkety keeps lot sizing and leg allocation explicit per account. Existing accounts are never migrated to a new sizing mode automatically.

## fixed

The owner's `lot_value` is the requested lot for each target leg.

Broker minimum, maximum and step are applied exactly as in the existing production path: a below-minimum preference is raised to the broker minimum, valid requests are floored to the broker step, and values are capped at the broker maximum. This compatibility behaviour is deliberately preserved for existing fixed-lot accounts.

This remains the default.

## adaptive_percent

A simple percentage of the owner's chosen/reference lot.

Example: reference lot `1.00`, percent `25` -> `0.25`, then the existing broker-minimum floor, step normalization and maximum validation. This preserves the pre-existing adaptive sizing behaviour.

This mode does not compare economic weight between different products.

## symbol_equivalent

Recommended when one connected account trades different products or asset classes.

Configuration:
- `lot_value`: the owner's chosen/reference lot.
- `lot_sizing_config.referenceSymbol`: the familiar symbol on which that lot is considered normal.

Rules:
1. Ask the broker for expected margin of the reference symbol at the owner's chosen lot.
2. Ask the broker for expected margin of the destination symbol at the same chosen lot.
3. If the destination symbol is not economically heavier, keep the owner's chosen lot.
4. If it is heavier, reduce to the largest broker-executable lot whose expected margin does not exceed the reference symbol's expected margin.
5. Never increase above the owner's chosen lot merely because another product is cheaper.
6. If the destination broker minimum is above the owner's requested lot, sizing fails closed; it does not silently increase the symbol-equivalent position.
7. Broker min/max/step are always authoritative.

This mode does not use account balance, equity, free margin, SL, or TP as a sizing input. It therefore works with fast signals.

## balance_percent

Separate opt-in account-capacity sizing.

Configuration:
- `lot_value`: owner-selected maximum lot per target before optional leg splitting.
- `lot_sizing_config.percent`: percent of broker-reported account balance available as the expected-margin budget.

Rules:
1. Compute budget = broker-reported balance × selected percentage.
2. Never exceed the owner's maximum lot.
3. Reduce to the largest broker-executable lot whose expected margin fits the budget.
4. If the owner's maximum lot is below the broker minimum, or even the broker minimum exceeds the margin budget, fail closed.
5. No SL/TP is required, so this mode also supports fast signals.

## risk_percent

The SL-based risk engine is a separate sizing approach. The configured percentage or fixed-cash budget applies independently to each executable TP leg. For example, 1% per leg with three targets means 3% aggregate planned risk. `maxRiskPercent` is checked per leg; `maxOpenRiskPercent` checks aggregate exposure. Risk sizing requires reliable stop-loss geometry and broker monetary loss conversion.

### Risk configuration and authority

Risk sizing remains stored under the existing `risk_percent` lot-sizing type so that the active D1 account schema does not need a table rebuild or a change to its existing CHECK constraint. The per-account `lot_sizing_config` carries:
- `riskBasis`: `equity` or `balance`.
- `riskMode`: `percent` or `fixed_cash`.

`lot_value` is interpreted as a percentage (0–100) when `riskMode=percent`, or as a positive cash amount when `riskMode=fixed_cash`. The API accepts the explicit equity/balance/fixed-cash labels as input aliases but persists the canonical `risk_percent` type.

The optional `safety_policy` risk limits are:
- `maxRiskPercent`: maximum actual risk per TP leg.
- `maxOpenRiskPercent`: maximum aggregate open exposure, including all TP legs.
- `maxDailyLossPercent`: daily loss lock.
- `minimumVolumeRiskTolerancePercent`: narrowly bounded allowance for broker minimum-volume excess.
- `minimumLotPolicy`: `FLOOR` or `REJECT`; any floor is still checked against the explicit tolerance.

Risk configuration mutations are owner-only. Ordinary `accounts.write` permission is not sufficient. Every write is scoped to the selected account and workspace. New account creation and follower risk policy changes use the same owner-only boundary. No deployment, restart, or schema migration activates risk settings for an existing account.

Follower risk is independent of parent risk. Each follower uses its own stored risk mode/basis and its own broker account metrics; it must be revalidated immediately before its own broker dispatch. Failure of one follower must not alter the parent or another follower.

cTrader risk-sized OPEN remains blocked until the adapter can provide a reliable monetary loss-at-stop calculation. Missing or stale account/symbol facts, missing SL economics, or risk beyond configured limits must fail closed.

## Leg allocation

Fixed, adaptive, symbol-equivalent and balance-percent lot values are interpreted per target leg. SL-based risk sizing also applies its configured risk budget independently to each executable TP leg; the aggregate is separately checked against the open-risk ceiling. No mode divides a single per-leg risk budget across the TP list.

## Broker authority

- cTrader OAuth uses cTrader broker symbol metadata and expected-margin responses.
- MT5 connector uses that account's connected MetaTrader terminal, `order_calc_margin`, and live symbol min/max/step.
- Unsupported or unavailable broker context fails closed instead of using a generic cross-asset estimate.
- Newly routed/enabled accounts continue to hydrate their own symbol catalogs from their own broker connection; catalogs are never copied across accounts or workspaces.

## Deployment note

MT5 `symbol_equivalent` and `balance_percent` require the connector build that supports `sizing_request`. Existing `fixed` accounts remain compatible with older connector builds and are not changed by this feature.


### Local MT5 copier boundary

The local MT5 copier is a separate, explicitly opt-in profile feature. New profiles default to `copy_enabled=false`, `copy_role=none`, and `copy_risk_mode=fixed_lot`; saving a profile does not start a worker. A local profile owner must explicitly configure the follower and start its worker. Changing settings stops the existing pair worker before writing the new startup policy. Local copier risk is calculated from the follower terminal's own broker snapshot, not from the parent's account metrics.


### Minimum-volume compatibility boundary

The legacy `fixed` and `adaptive_percent` modes retain their existing production behaviour: broker minimum-volume flooring is preserved. `symbol_equivalent` and `balance_percent` retain their broker-budget fail-closed behaviour. Only the new SL-based `risk_percent` mode uses the explicit `minimumLotPolicy` plus `minimumVolumeRiskTolerancePercent` controls to authorize or reject a minimum-volume risk overage. This separation prevents the risk feature from silently changing existing account behaviour.
