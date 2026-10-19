"""Run an opt-in local MT5 copy pair outside the gateway connector workers."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path

from local_copier import LocalCopyEngine


def _positive(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


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
        account = mt5.account_info()
        if account is None:
            return {'complete': False, 'reason': 'MT5_ACCOUNT_UNAVAILABLE'}
        margin_mode = getattr(account, 'margin_mode', None)
        if margin_mode == getattr(mt5, 'ACCOUNT_MARGIN_MODE_RETAIL_HEDGING', 2):
            account_mode = 'HEDGING'
        elif margin_mode == getattr(mt5, 'ACCOUNT_MARGIN_MODE_EXCHANGE', 1):
            account_mode = 'EXCHANGE_NETTING'
        elif margin_mode == getattr(mt5, 'ACCOUNT_MARGIN_MODE_RETAIL_NETTING', 0):
            account_mode = 'NETTING'
        else:
            account_mode = 'UNKNOWN'
        positions = mt5.positions_get()
        if positions is None:
            return {'complete': False, 'reason': 'MT5_POSITIONS_UNAVAILABLE'}
        result = []
        symbols = {}
        for row in positions:
            symbol = str(getattr(row, 'symbol', ''))
            if symbol not in symbols:
                symbols[symbol] = mt5.symbol_info(symbol)
            symbol_info = symbols[symbol]
            side = 'BUY' if int(getattr(row, 'type', 1)) == int(getattr(mt5, 'ORDER_TYPE_BUY', 0)) else 'SELL'
            result.append({'ticket': str(getattr(row, 'ticket', '')), 'symbol': symbol, 'side': side,
                           'volume': float(getattr(row, 'volume', 0) or 0), 'sl': getattr(row, 'sl', None), 'tp': getattr(row, 'tp', None),
                           'volume_min': getattr(symbol_info, 'volume_min', None), 'volume_step': getattr(symbol_info, 'volume_step', None)})
        return {'complete': True, 'account_mode': account_mode, 'positions': result}
    finally:
        mt5.shutdown()


def _fingerprint(snapshot):
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class CopyJournal:
    def __init__(self, path):
        self.path = Path(path).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.db = sqlite3.connect(str(self.path))
        except sqlite3.OperationalError as exc:
            raise RuntimeError(f'could not open local copier journal at {self.path}: {exc}') from exc
        self.db.execute('CREATE TABLE IF NOT EXISTS copy_state(source_ticket TEXT PRIMARY KEY, follower_position_id TEXT, fingerprint TEXT NOT NULL)')
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(copy_state)')}
        if 'source_initial_volume' not in columns:
            self.db.execute('ALTER TABLE copy_state ADD COLUMN source_initial_volume REAL')
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
        return {str(row[0]): {'source_ticket': str(row[0]), 'ticket': row[1], 'source_initial_volume': row[2]}
                for row in self.db.execute('SELECT source_ticket,follower_position_id,source_initial_volume FROM copy_state')}

    def record(self, source_ticket, follower_position_id, fingerprint, source_initial_volume=None):
        self.db.execute(
            'INSERT INTO copy_state(source_ticket,follower_position_id,fingerprint,source_initial_volume) VALUES(?,?,?,?) '
            'ON CONFLICT(source_ticket) DO UPDATE SET follower_position_id=excluded.follower_position_id, '
            'fingerprint=excluded.fingerprint, source_initial_volume=COALESCE(copy_state.source_initial_volume, excluded.source_initial_volume)',
            (str(source_ticket), str(follower_position_id or ''), str(fingerprint), source_initial_volume),
        )
        self.db.commit()

    def remove(self, source_ticket):
        self.db.execute('DELETE FROM copy_state WHERE source_ticket = ?', (str(source_ticket),))
        self.db.commit()


def run(args):
    mt5 = _load_mt5()
    journal = CopyJournal(Path(args.journal))
    try:
        while True:
            if args.stop_file and Path(args.stop_file).exists():
                return
            parent = _snapshot(mt5, args.parent_terminal)
            if not parent.get('complete'):
                time.sleep(args.poll_seconds)
                continue
            if args.stop_file and Path(args.stop_file).exists():
                return
            follower = _snapshot(mt5, args.follower_terminal)
            if not follower.get('complete'):
                time.sleep(args.poll_seconds)
                continue
            if args.stop_file and Path(args.stop_file).exists():
                return
            source_by_follower = {str(row.get('ticket')): source for source, row in journal.follower_rows().items() if row.get('ticket')}
            journal_rows = journal.follower_rows()
            parent_by_ticket = {str(row.get('ticket')): row for row in parent.get('positions', []) if row.get('ticket')}
            for source_ticket, linked in journal_rows.items():
                source_position = parent_by_ticket.get(source_ticket)
                if source_position and _positive(source_position.get('volume')) and not linked.get('source_initial_volume'):
                    # Existing journal rows predate proportional sizing. Treat
                    # their first post-upgrade snapshot as the safe baseline.
                    journal.record(source_ticket, linked.get('ticket'), _fingerprint(parent), _positive(source_position.get('volume')))
            journal_rows = journal.follower_rows()
            initial_source_volume = {source: row.get('source_initial_volume') for source, row in journal_rows.items()}
            follower['positions'] = [{**row, 'source_ticket': source_by_follower.get(str(row.get('ticket')), ''),
                                      'source_initial_volume': initial_source_volume.get(source_by_follower.get(str(row.get('ticket')), ''))}
                                     for row in follower.get('positions', [])]
            try:
                symbol_map = json.loads(getattr(args, 'symbol_map', '{}') or '{}')
            except json.JSONDecodeError as exc:
                raise RuntimeError('invalid local copier symbol map') from exc
            engine = LocalCopyEngine(args.parent_profile, args.follower_profile, args.lot_multiplier, args.fixed_lot,
                                     enabled=True, symbol_map=symbol_map)
            actions = engine.plan(parent, follower)
            if actions and mt5.initialize(path=str(args.follower_terminal)):
                try:
                    broker = _load_engine(mt5)
                    for index, action in enumerate(actions, 1):
                        if args.stop_file and Path(args.stop_file).exists():
                            return
                        source_ticket = action.get('source_ticket')
                        command_id = f'local-copy:{args.parent_profile}:{args.follower_profile}:{source_ticket}:{index}'
                        action_type = action.get('type')
                        if action_type == 'OPEN_POSITION':
                            command = {'action': 'OPEN_POSITION', 'symbol': action['symbol'], 'side': action['side'], 'volume': action['lots'],
                                       'orderType': 'MARKET', 'stopLoss': action.get('stop_loss'), 'takeProfit': action.get('take_profit'),
                                       'resolvePosition': True}
                        elif action_type == 'MODIFY_POSITION':
                            command = {'action': 'MODIFY_POSITION', 'positionId': action.get('position_id'), 'stopLoss': action.get('stop_loss'), 'takeProfit': action.get('take_profit')}
                        elif action_type == 'CLOSE_POSITION':
                            command = {'action': 'CLOSE_POSITION', 'positionId': action.get('position_id')}
                        elif action_type == 'CLOSE_PARTIAL':
                            command = {'action': 'CLOSE_PARTIAL', 'positionId': action.get('position_id'), 'volume': action['lots']}
                        else:
                            continue
                        result = broker.execute_reconciled(command, command_id)
                        if result.get('ok'):
                            if action_type == 'CLOSE_POSITION':
                                # A closed source must not be re-emitted on every poll.
                                journal.remove(source_ticket)
                            else:
                                source_position = parent_by_ticket.get(str(source_ticket), {})
                                if action_type == 'OPEN_POSITION':
                                    follower_position_id = result.get('position_id') or result.get('ticket')
                                else:
                                    # Modify/close responses may identify the
                                    # order or deal. Keep the actual linked
                                    # follower position ticket in the journal.
                                    follower_position_id = action.get('position_id')
                                journal.record(source_ticket, follower_position_id,
                                               _fingerprint(parent), _positive(source_position.get('volume')))
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
    parser.add_argument('--symbol-map', default='{}')
    parser.add_argument('--poll-seconds', type=int, default=2)
    parser.add_argument('--journal', default='local-copy-ledger.sqlite')
    parser.add_argument('--stop-file', default=None)
    return run(parser.parse_args(argv))


if __name__ == '__main__':
    main()
