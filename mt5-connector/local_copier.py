"""Optional, local-only MT5 parent/follower copy engine.

The engine is deliberately broker-agnostic and only consumes complete snapshots
from adapters. It never interprets an absent/uncertain snapshot as a close.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


def _positive(value, fallback=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def _source_ticket(position):
    return str(position.get("source_ticket") or position.get("ticket") or "").strip()


def _closable_volume(value, minimum, step):
    """Round partial closes down to broker volume steps; never round upward."""
    try:
        amount = float(value)
        min_lot = float(minimum or 0)
        lot_step = float(step or 0)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    if lot_step > 0:
        amount = (int((amount + 1e-9) / lot_step)) * lot_step
    if amount <= 0 or (min_lot > 0 and amount + 1e-9 < min_lot):
        return None
    return round(amount, 8)


def _broker_order_volume(value, order):
    """Mirror MT5's target-side min/step rounding when comparing live orders."""
    try:
        amount = float(value)
        minimum = float(order.get("volume_min") or 0)
        step = float(order.get("volume_step") or 0)
        maximum = float(order.get("volume_max") or 0)
    except (TypeError, ValueError):
        return None
    if amount <= 0:
        return None
    if minimum > 0 and amount < minimum:
        amount = minimum
    if maximum > 0 and amount > maximum:
        amount = maximum
    if step > 0:
        origin = minimum if minimum > 0 else 0.0
        amount = origin + max(0, int((amount - origin + 1e-9) / step)) * step
        if minimum > 0 and amount < minimum:
            amount = minimum
    return round(amount, 8)


def _risk_sized_volume(row, follower_snapshot, *, risk_mode='fixed_lot', risk_percent=None, risk_amount=None, risk_basis='equity'):
    """Calculate follower lots from follower funds and a precomputed 1-lot SL loss.

    The broker adapter must populate loss_per_lot_at_stop using the follower's
    symbol/contract specification. Missing SL, funds, or loss estimates fail closed.
    """
    mode = str(risk_mode or 'fixed_lot').strip().lower()
    if mode not in {'fixed_risk', 'equity_percent', 'balance_percent'}:
        return None
    try:
        loss = abs(float(row.get('loss_per_lot_at_stop')))
        funds_key = 'balance' if mode == 'balance_percent' or str(risk_basis).lower() == 'balance' else 'equity'
        funds = float((follower_snapshot or {}).get(funds_key))
        step = float(row.get('volume_step') or 0)
        minimum = float(row.get('volume_min') or step)
        maximum = float(row.get('volume_max') or float('inf'))
        if mode == 'fixed_risk':
            budget = float(risk_amount)
        else:
            budget = funds * float(risk_percent) / 100.0
    except (TypeError, ValueError):
        return None
    if not (loss > 0 and funds > 0 and budget > 0 and step > 0 and minimum > 0 and maximum >= minimum):
        return None
    raw = budget / loss
    sized = (int((raw + 1e-12) / step)) * step
    if sized + 1e-12 < minimum:
        return None
    sized = min(sized, maximum)
    return round(sized, 8)


def plan_snapshot_actions(parent_snapshot: dict, follower_snapshot: dict, *, lot_multiplier=1, fixed_lot=None, risk_mode='fixed_lot', risk_percent=None, risk_amount=None, risk_basis='equity', symbol_map=None):
    if not isinstance(parent_snapshot, dict) or parent_snapshot.get("complete") is not True:
        return []
    multiplier = _positive(lot_multiplier)
    fixed = _positive(fixed_lot)
    if multiplier is None and fixed is None:
        raise ValueError("LOT_MULTIPLIER_INVALID")
    parent_positions = parent_snapshot.get("positions")
    follower_positions = follower_snapshot.get("positions") if isinstance(follower_snapshot, dict) else None
    if not isinstance(parent_positions, list) or not isinstance(follower_positions, list):
        return []
    parent_orders = parent_snapshot.get("pending_orders", [])
    follower_orders = follower_snapshot.get("pending_orders", [])
    if not isinstance(parent_orders, list) or not isinstance(follower_orders, list):
        return []
    parent_by_ticket = {_source_ticket(row): row for row in parent_positions if _source_ticket(row)}
    mapped_symbols = {str(key).strip().casefold(): str(value).strip() for key, value in (symbol_map or {}).items()}
    target_symbol_by_ticket = {
        ticket: mapped_symbols.get(str(row.get("symbol") or "").strip().casefold(), str(row.get("symbol") or "").strip())
        for ticket, row in parent_by_ticket.items()
    }
    blocked_netting_symbols = set()
    account_mode = str((follower_snapshot or {}).get("account_mode") or "").upper()
    if account_mode in {"NETTING", "EXCHANGE_NETTING"}:
        counts = {}
        for target_symbol in target_symbol_by_ticket.values():
            counts[target_symbol] = counts.get(target_symbol, 0) + 1
        blocked_netting_symbols.update(symbol for symbol, count in counts.items() if count > 1)
        for row in follower_positions:
            symbol = str(row.get("symbol") or "").strip()
            if symbol and not str(row.get("source_ticket") or "").strip():
                blocked_netting_symbols.add(symbol)
    # Only touch follower positions that the copy journal explicitly links to a
    # parent ticket. Unlinked/manual positions belong to the follower owner.
    follower_by_ticket = {
        str(row.get("source_ticket") or "").strip(): row
        for row in follower_positions
        if str(row.get("source_ticket") or "").strip()
    }
    position_actions = []
    for source_ticket, parent in sorted(parent_by_ticket.items()):
        source_symbol = str(parent.get("symbol") or "").strip()
        symbol = target_symbol_by_ticket.get(source_ticket, source_symbol)
        if symbol in blocked_netting_symbols:
            continue
        side = str(parent.get("side") or "").strip().upper()
        lots = _positive(parent.get("volume") or parent.get("lots"))
        if not symbol or side not in {"BUY", "SELL"} or lots is None:
            continue
        risk_row = {**parent, 'volume_min': parent.get('volume_min'), 'volume_step': parent.get('volume_step'), 'volume_max': parent.get('volume_max')}
        risk_lots = _risk_sized_volume(risk_row, follower_snapshot, risk_mode=risk_mode, risk_percent=risk_percent, risk_amount=risk_amount, risk_basis=risk_basis)
        desired_lots = risk_lots if risk_lots is not None else (fixed if fixed is not None else lots * multiplier)
        if risk_mode in {'fixed_risk', 'equity_percent', 'balance_percent'} and risk_lots is None:
            continue
        if desired_lots is None or desired_lots <= 0:
            continue
        current = follower_by_ticket.get(source_ticket)
        if current is None:
            if parent.get("pending_link_unresolved") is True:
                continue
            position_actions.append({"type": "OPEN_POSITION", "source_ticket": source_ticket, "symbol": symbol,
                            "side": side, "lots": desired_lots, "stop_loss": parent.get("sl"), "take_profit": parent.get("tp")})
            continue
        if current.get("sl") != parent.get("sl") or current.get("tp") != parent.get("tp"):
            position_actions.append({"type": "MODIFY_POSITION", "source_ticket": source_ticket, "position_id": current.get("ticket"),
                            "symbol": symbol, "stop_loss": parent.get("sl"), "take_profit": parent.get("tp")})
        follower_lots = _positive(current.get("volume"))
        if fixed is not None:
            initial_source_lots = _positive(current.get("source_initial_volume"))
            if initial_source_lots is not None:
                desired_lots = fixed * lots / initial_source_lots
        if follower_lots is not None and follower_lots > desired_lots + 1e-7:
            close_lots = _closable_volume(follower_lots - desired_lots, current.get("volume_min"), current.get("volume_step"))
            if close_lots is not None:
                position_actions.append({"type": "CLOSE_PARTIAL", "source_ticket": source_ticket,
                                "position_id": current.get("ticket"), "lots": close_lots})
    for source_ticket, current in sorted(follower_by_ticket.items()):
        if source_ticket not in parent_by_ticket:
            position_actions.append({"type": "CLOSE_POSITION", "source_ticket": source_ticket, "position_id": current.get("ticket")})

    parent_order_by_ticket = {_source_ticket(row): row for row in parent_orders if _source_ticket(row)}
    follower_order_by_ticket = {
        str(row.get("source_ticket") or "").strip(): row
        for row in follower_orders if str(row.get("source_ticket") or "").strip()
    }
    pending_actions = []
    for source_ticket, parent in sorted(parent_order_by_ticket.items()):
        source_symbol = str(parent.get("symbol") or "").strip()
        symbol = mapped_symbols.get(source_symbol.casefold(), source_symbol)
        side = str(parent.get("side") or "").strip().upper()
        order_type = str(parent.get("order_type") or "").strip().upper()
        lots = _positive(parent.get("volume"))
        entry_price = _positive(parent.get("entry_price"))
        stop_limit_price = _positive(parent.get("stop_limit_price"))
        if (not symbol or side not in {"BUY", "SELL"} or order_type not in {"LIMIT", "STOP", "STOP_LIMIT"}
                or lots is None or entry_price is None or (order_type == "STOP_LIMIT" and stop_limit_price is None)):
            continue
        risk_row = {**parent, 'volume_min': parent.get('volume_min'), 'volume_step': parent.get('volume_step'), 'volume_max': parent.get('volume_max')}
        risk_lots = _risk_sized_volume(risk_row, follower_snapshot, risk_mode=risk_mode, risk_percent=risk_percent, risk_amount=risk_amount, risk_basis=risk_basis)
        desired_lots = risk_lots if risk_lots is not None else (fixed if fixed is not None else lots * multiplier)
        if risk_mode in {'fixed_risk', 'equity_percent', 'balance_percent'} and risk_lots is None:
            continue
        current = follower_order_by_ticket.get(source_ticket)
        if current is None:
            pending_actions.append({"type": "OPEN_PENDING", "source_ticket": source_ticket, "symbol": symbol,
                                    "side": side, "order_type": order_type, "lots": desired_lots,
                                    "entry_price": entry_price, "stop_loss": parent.get("sl"), "take_profit": parent.get("tp"),
                                    "stop_limit_price": stop_limit_price,
                                    "time_type": parent.get("time_type"), "expiration": parent.get("expiration")})
            continue
        current_volume = _positive(current.get("volume"))
        normalized_desired = _broker_order_volume(desired_lots, current)
        needs_replace = (str(current.get("symbol") or "").strip() != symbol
                         or str(current.get("side") or "").strip().upper() != side
                         or str(current.get("order_type") or "").strip().upper() != order_type
                         or (current_volume is not None and normalized_desired is not None
                             and abs(current_volume - normalized_desired) > 1e-7))
        if needs_replace:
            pending_actions.append({"type": "CANCEL_PENDING", "source_ticket": source_ticket,
                                    "order_id": current.get("ticket")})
            pending_actions.append({"type": "OPEN_PENDING", "source_ticket": source_ticket, "symbol": symbol,
                                    "side": side, "order_type": order_type, "lots": desired_lots,
                                    "entry_price": entry_price, "stop_loss": parent.get("sl"), "take_profit": parent.get("tp"),
                                    "stop_limit_price": stop_limit_price,
                                    "time_type": parent.get("time_type"), "expiration": parent.get("expiration")})
            continue
        if (current.get("entry_price") != entry_price or current.get("sl") != parent.get("sl")
                or current.get("tp") != parent.get("tp") or current.get("time_type") != parent.get("time_type")
                or current.get("expiration") != parent.get("expiration")
                or (order_type == "STOP_LIMIT" and current.get("stop_limit_price") != stop_limit_price)):
            pending_actions.append({"type": "MODIFY_PENDING", "source_ticket": source_ticket,
                                    "order_id": current.get("ticket"), "entry_price": entry_price,
                                    "stop_loss": parent.get("sl"), "take_profit": parent.get("tp"),
                                    "stop_limit_price": stop_limit_price,
                                    "time_type": parent.get("time_type"), "expiration": parent.get("expiration")})
    for source_ticket, current in sorted(follower_order_by_ticket.items()):
        if source_ticket not in parent_order_by_ticket:
            pending_actions.append({"type": "CANCEL_PENDING", "source_ticket": source_ticket,
                                    "order_id": current.get("ticket")})
    for current in follower_positions:
        orphan_source = str(current.get("orphan_pending_source_ticket") or "").strip()
        if orphan_source and orphan_source not in parent_order_by_ticket:
            pending_actions.append({"type": "CLOSE_PENDING_FILL", "source_ticket": orphan_source,
                                    "position_id": current.get("ticket")})
    # Cancel a stale pending order before opening any market position that may
    # have replaced it. The worker stops the iteration if cancellation fails.
    pending_actions.sort(key=lambda action: 0 if action["type"] == "CANCEL_PENDING" else 1)
    return pending_actions + position_actions


@dataclass
class LocalCopyEngine:
    """Apply a pure snapshot diff through an injected broker adapter."""

    parent_profile_id: str
    follower_profile_id: str
    lot_multiplier: float = 1
    fixed_lot: float | None = None
    enabled: bool = False
    execute: Callable | None = None
    symbol_map: dict | None = None
    risk_mode: str = 'fixed_lot'
    risk_percent: float | None = None
    risk_amount: float | None = None
    risk_basis: str = 'equity'

    def plan(self, parent_snapshot, follower_snapshot):
        if not self.enabled:
            return []
        return plan_snapshot_actions(parent_snapshot, follower_snapshot, lot_multiplier=self.lot_multiplier, fixed_lot=self.fixed_lot,
                                     risk_mode=self.risk_mode, risk_percent=self.risk_percent, risk_amount=self.risk_amount,
                                     risk_basis=self.risk_basis, symbol_map=self.symbol_map)

    def apply(self, parent_snapshot, follower_snapshot):
        actions = self.plan(parent_snapshot, follower_snapshot)
        if not actions:
            return []
        if not callable(self.execute):
            raise RuntimeError("LOCAL_COPIER_EXECUTOR_UNAVAILABLE")
        results = []
        for action in actions:
            results.append(self.execute(action))
        return results
