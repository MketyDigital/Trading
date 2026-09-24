# Lot sizing modes

Mkety keeps sizing modes explicit and per account. Changing a sizing mode never changes account activation, execution, LIVE permission, routes, or global runtime controls.

## fixed

`lot_value` is the requested lot size per target leg. The broker symbol catalog remains authoritative for minimum, maximum, and step. If the preference is below the broker minimum, fixed sizing may use the broker minimum.

## adaptive_percent

`lot_value` is a reference lot and `lot_sizing_config.percent` is a percentage of it. Example: reference `1.00`, percent `25` -> `0.25` requested per target, then broker min/max/step normalization applies.

This is a simple proportional lot mode. It does not attempt to equalize economic exposure between different asset classes.

## margin_equivalent

This is the cross-market equivalent-exposure mode.

Configuration:
- `lot_value`: familiar reference lot per target, for example `0.90`.
- `lot_sizing_config.referenceSymbol`: familiar reference instrument, for example `GBPUSD`.
- `lot_sizing_config.maxMarginPercent`: maximum percentage of the available account-capacity basis that may be used by one target leg. Default when omitted by supported APIs is 10%.

Execution:
1. Ask the broker for the expected margin of the configured reference symbol at the configured reference lot.
2. Cap that reference margin by the configured account-capacity percentage.
3. Ask the broker for expected margin on the destination symbol.
4. Choose the largest broker-executable destination lot whose expected margin does not exceed the budget.
5. Apply the existing account safety policy to aggregate target-leg lots.
6. If even the destination symbol's minimum lot exceeds the budget, fail closed with `MARGIN_EQUIVALENT_BELOW_BROKER_MINIMUM`. Do not round upward and create more exposure than intended.

This mode does not require SL or TP and therefore supports Mkety fast-entry behavior where protection may be supplied later.

### Broker authority

- cTrader OAuth: uses cTrader `ProtoOAExpectedMargin` responses. Account balance is used as the conservative account-capacity basis available from the loaded trader metadata.
- MT5 connector: uses MetaTrader 5 `order_calc_margin` locally in the existing connector. Capacity prefers free margin, then equity, then balance.
- Broker min/max/step always remain authoritative.
- Unsupported broker connection modes fail closed instead of estimating with a generic cross-asset formula.

### Operational notes

Existing accounts are not migrated into this mode automatically. Operators must explicitly select it per account. MT5 accounts require a connector build containing margin-equivalent support before the mode is enabled on that account.
