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


def plan_snapshot_actions(parent_snapshot: dict, follower_snapshot: dict, *, lot_multiplier=1, fixed_lot=None):
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
    parent_by_ticket = {_source_ticket(row): row for row in parent_positions if _source_ticket(row)}
    follower_by_ticket = {_source_ticket(row): row for row in follower_positions if _source_ticket(row)}
    actions = []
    for source_ticket, parent in sorted(parent_by_ticket.items()):
        symbol = str(parent.get("symbol") or "").strip()
        side = str(parent.get("side") or "").strip().upper()
        lots = _positive(parent.get("volume") or parent.get("lots"))
        if not symbol or side not in {"BUY", "SELL"} or lots is None:
            continue
        desired_lots = fixed if fixed is not None else lots * multiplier
        if desired_lots is None or desired_lots <= 0:
            continue
        current = follower_by_ticket.get(source_ticket)
        if current is None:
            actions.append({"type": "OPEN_POSITION", "source_ticket": source_ticket, "symbol": symbol,
                            "side": side, "lots": desired_lots, "stop_loss": parent.get("sl"), "take_profit": parent.get("tp")})
            continue
        if current.get("sl") != parent.get("sl") or current.get("tp") != parent.get("tp"):
            actions.append({"type": "MODIFY_POSITION", "source_ticket": source_ticket, "position_id": current.get("ticket"),
                            "symbol": symbol, "stop_loss": parent.get("sl"), "take_profit": parent.get("tp")})
    for source_ticket, current in sorted(follower_by_ticket.items()):
        if source_ticket not in parent_by_ticket:
            actions.append({"type": "CLOSE_POSITION", "source_ticket": source_ticket, "position_id": current.get("ticket")})
    return actions


@dataclass
class LocalCopyEngine:
    """Apply a pure snapshot diff through an injected broker adapter."""

    parent_profile_id: str
    follower_profile_id: str
    lot_multiplier: float = 1
    fixed_lot: float | None = None
    enabled: bool = False
    execute: Callable | None = None

    def plan(self, parent_snapshot, follower_snapshot):
        if not self.enabled:
            return []
        return plan_snapshot_actions(parent_snapshot, follower_snapshot, lot_multiplier=self.lot_multiplier, fixed_lot=self.fixed_lot)

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

