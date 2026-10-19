"""Run an opt-in local MT5 copy pair outside the gateway connector workers."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path

from local_copier import LocalCopyEngine


def _load_engine(mt5):
    import sys
    bridge_path = Path(__file__).resolve().parents[1] / 'cloudflare-v2' / 'bridges'
    if str(bridge_path) not in sys.path:
        sys.path.insert(0, str(bridge_path))
    from mt5_bridge import MT5Engine
    return MT5Engine(mt5)


def _load_mt5():
    import MetaTrader5 as mt5
    return mt5


def _snapshot(mt5, terminal_path, *, include_positions=True):
    if not mt5.initialize(path=str(terminal_path)):
        return {'complete': False, 'reason': 'MT5_INITIALIZE_FAILED'}
    try:
        positions = mt5.positions_get()
        if positions is None:
            return {'complete': False, 'reason': 'MT5_POSITIONS_UNAVAILABLE'}
        result = []
        for row in positions:
            side = 'BUY' if int(getattr(row, 'type', 1)) == int(getattr(mt5, 'ORDER_TYPE_BUY', 0)) else 'SELL'
            result.append({'ticket': str(getattr(row, 'ticket', '')), 'symbol': str(getattr(row, 'symbol', '')), 'side': side,
                           'volume': float(getattr(row, 'volume', 0) or 0), 'sl': getattr(row, 'sl', None), 'tp': getattr(row, 'tp', None)})
        return {'complete': True, 'positions': result}
    finally:
        mt5.shutdown()


def _fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class CopyJournal:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path))
        self.db.execute('CREATE TABLE IF NOT EXISTS copy_state(source_ticket TEXT PRIMARY KEY, follower_position_id TEXT, fingerprint TEXT NOT NULL)')
        self.db.commit()

    def close(self):
        """Close the SQLite handle so temporary/profile directories are removable on Windows."""
        db, self.db = self.db, None
        if db is not None:
            db.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def follower_rows(self):
        return {str(row[0]): {'source_ticket': str(row[0]), 'ticket': row[1]} for row in self.db.execute('SELECT source_ticket,follower_position_id FROM copy_state')}

    def record(self, source_ticket, follower_position_id, fingerprint):
        self.db.execute('INSERT OR REPLACE INTO copy_state(source_ticket,follower_position_id,fingerprint) VALUES(?,?,?)', (str(source_ticket), str(follower_position_id or ''), str(fingerprint)))
        self.db.commit()

    def remove(self, source_ticket):
        self.db.execute('DELETE FROM copy_state WHERE source_ticket = ?', (str(source_ticket),))
        self.db.commit()


def run(args):
    mt5 = _load_mt5()
    journal = CopyJournal(Path(args.journal))
    try:
        while True:
            parent = _snapshot(mt5, args.parent_terminal)
            if not parent.get('complete'):
                time.sleep(args.poll_seconds)
                continue
            follower = _snapshot(mt5, args.follower_terminal)
            if not follower.get('complete'):
                time.sleep(args.poll_seconds)
                continue
            source_by_follower = {str(row.get('ticket')): source for source, row in journal.follower_rows().items() if row.get('ticket')}
            follower['positions'] = [{**row, 'source_ticket': source_by_follower.get(str(row.get('ticket')), '')} for row in follower.get('positions', [])]
            engine = LocalCopyEngine(args.parent_profile, args.follower_profile, args.lot_multiplier, args.fixed_lot, True)
            actions = engine.plan(parent, follower)
            if actions and mt5.initialize(path=str(args.follower_terminal)):
                try:
                    broker = _load_engine(mt5)
                    for index, action in enumerate(actions, 1):
                        source_ticket = action.get('source_ticket')
                        command_id = f'local-copy:{args.parent_profile}:{args.follower_profile}:{source_ticket}:{index}'
                        action_type = action.get('type')
                        if action_type == 'OPEN_POSITION':
                            command = {'action': 'OPEN_POSITION', 'symbol': action['symbol'], 'side': action['side'], 'volume': action['lots'],
                                       'orderType': 'MARKET', 'stopLoss': action.get('stop_loss'), 'takeProfit': action.get('take_profit')}
                        elif action_type == 'MODIFY_POSITION':
                            command = {'action': 'MODIFY_POSITION', 'positionId': action.get('position_id'), 'stopLoss': action.get('stop_loss'), 'takeProfit': action.get('take_profit')}
                        elif action_type == 'CLOSE_POSITION':
                            command = {'action': 'CLOSE_POSITION', 'positionId': action.get('position_id')}
                        else:
                            continue
                        result = broker.execute_reconciled(command, command_id)
                        if result.get('ok'):
                            if action_type == 'CLOSE_POSITION':
                                # A closed source must not be re-emitted on every poll.
                                journal.remove(source_ticket)
                            else:
                                journal.record(source_ticket, result.get('position_id') or result.get('ticket') or action.get('position_id'), _fingerprint(parent))
                finally:
                    mt5.shutdown()
            time.sleep(args.poll_seconds)
    finally:
        journal.close()


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--parent-profile', required=True)
    parser.add_argument('--follower-profile', required=True)
    parser.add_argument('--parent-terminal', required=True)
    parser.add_argument('--follower-terminal', required=True)
    parser.add_argument('--lot-multiplier', type=float, default=1.0)
    parser.add_argument('--fixed-lot', type=float, default=None)
    parser.add_argument('--poll-seconds', type=int, default=2)
    parser.add_argument('--journal', default='local-copy-ledger.sqlite')
    return run(parser.parse_args(argv))


if __name__ == '__main__':
    main()
