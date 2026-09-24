# Lot sizing modes

Mkety keeps lot sizing and leg allocation explicit per account. Existing accounts are never migrated to a new sizing mode automatically.

## fixed

The owner's `lot_value` is the requested lot for each target leg.

Broker symbol minimum, maximum and step remain authoritative. If the owner's chosen lot is below the broker's minimum, the broker minimum can be used.

This is the current behavior and remains the default.

## adaptive_percent

A simple percentage of the owner's chosen/reference lot.

Example: reference lot `1.00`, percent `25` -> `0.25`, then broker min/max/step normalization.

This mode does not compare economic weight between different products.

## symbol_equivalent

Recommended when one connected account trades different products or asset classes.

Configuration:
- `lot_value`: the owner's chosen/reference lot.
- `lot_sizing_config.referenceSymbol`: the familiar symbol on which that lot is considered normal.
- `lot_sizing_config.legAllocation`: independent leg allocation option.

Rules:
1. Ask the broker for expected margin of the reference symbol at the owner's chosen lot.
2. Ask the broker for expected margin of the destination symbol at the same chosen lot.
3. If the destination symbol is not economically heavier, keep the owner's chosen lot.
4. If it is heavier, reduce to the largest broker-executable lot whose expected margin does not exceed the reference symbol's expected margin.
5. Never increase above the owner's chosen lot merely because another product is cheaper.
6. The only upward exception is the destination broker's unavoidable minimum lot. Example: owner chooses `0.09`, destination minimum is `0.50` -> `0.50`.
7. Broker min/max/step are always authoritative.

This mode does not use account balance, equity, free margin, SL, or TP as a sizing input. It therefore works with fast signals.

## balance_percent

Separate opt-in account-capacity sizing.

Configuration:
- `lot_value`: owner-selected maximum lot per target before optional leg splitting.
- `lot_sizing_config.percent`: percent of broker-reported account balance available as the expected-margin budget.
- `lot_sizing_config.legAllocation`: independent leg allocation option.

Rules:
1. Compute budget = broker-reported balance × selected percentage.
2. Never exceed the owner's maximum lot.
3. Reduce to the largest broker-executable lot whose expected margin fits the budget.
4. If even the broker's minimum lot exceeds the budget, fail closed.
5. No SL/TP is required, so this mode also supports fast signals.

## risk_percent

The existing SL-based risk engine remains a separate sizing approach. It requires reliable risk geometry and does not replace symbol-equivalent or balance-percent sizing.

## Leg allocation is independent

`lot_sizing_config.legAllocation` is independent of the sizing mode:

- `per_target` (default): the sized lot applies to each TP leg. This preserves existing Mkety behavior.
- `split_total`: the sized lot is treated as the total and split across TP legs using broker volume step rules.

No existing account is changed automatically. Accounts without `legAllocation` continue as `per_target`.

## Broker authority

- cTrader OAuth uses cTrader broker symbol metadata and expected-margin responses.
- MT5 connector uses that account's connected MetaTrader terminal, `order_calc_margin`, and live symbol min/max/step.
- Unsupported or unavailable broker context fails closed instead of using a generic cross-asset estimate.
- Newly routed/enabled accounts continue to hydrate their own symbol catalogs from their own broker connection; catalogs are never copied across accounts or workspaces.

## Deployment note

MT5 `symbol_equivalent` and `balance_percent` require the connector build that supports `sizing_request`. Existing `fixed` accounts remain compatible with older connector builds and are not changed by this feature.
