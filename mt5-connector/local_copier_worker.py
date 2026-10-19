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
        pending = mt5.orders_get()
        if pending is None:
            return {'complete': False, 'reason': 'MT5_PENDING_ORDERS_UNAVAILABLE'}
        result = []
        symbols = {}
        for row in positions:
            symbol = str(getattr(row, 'symbol', ''))
            if symbol not in symbols:
                symbols[symbol] = mt5.symbol_info(symbol)
            symbol_info = symbols[symbol]
            side = 'BUY' if int(getattr(row, 'type', 1)) == int(getattr(mt5, 'ORDER_TYPE_BUY', 0)) else 'SELL'
            result.append({'ticket': str(getattr(row, 'ticket', '')), 'identifier': str(getattr(row, 'identifier', '') or ''),
                           'comment': str(getattr(row, 'comment', '') or ''), 'symbol': symbol, 'side': side,
                           'volume': float(getattr(row, 'volume', 0) or 0), 'sl': getattr(row, 'sl', None), 'tp': getattr(row, 'tp', None),
                           'volume_min': getattr(symbol_info, 'volume_min', None), 'volume_step': getattr(symbol_info, 'volume_step', None)})
        type_names = {
            getattr(mt5, 'ORDER_TYPE_BUY_LIMIT', 2): ('BUY', 'LIMIT'),
            getattr(mt5, 'ORDER_TYPE_SELL_LIMIT', 3): ('SELL', 'LIMIT'),
            getattr(mt5, 'ORDER_TYPE_BUY_STOP', 4): ('BUY', 'STOP'),
            getattr(mt5, 'ORDER_TYPE_SELL_STOP', 5): ('SELL', 'STOP'),
        }
        for constant, value in (('ORDER_TYPE_BUY_STOP_LIMIT', ('BUY', 'STOP_LIMIT')),
                                ('ORDER_TYPE_SELL_STOP_LIMIT', ('SELL', 'STOP_LIMIT'))):
            order_value = getattr(mt5, constant, None)
            if order_value is not None:
                type_names[order_value] = value
        pending_rows = []
        for row in pending:
            order_type = type_names.get(getattr(row, 'type', None))
            if order_type is None:
                # Stop-limit and broker-specific orders are deliberately not
                # coerced into a different order type.
                continue
            symbol = str(getattr(row, 'symbol', ''))
            if symbol not in symbols:
                symbols[symbol] = mt5.symbol_info(symbol)
            symbol_info = symbols[symbol]
            pending_rows.append({
                'ticket': str(getattr(row, 'ticket', '')), 'comment': str(getattr(row, 'comment', '') or ''),
                'symbol': symbol, 'side': order_type[0], 'order_type': order_type[1],
                'volume': float(getattr(row, 'volume_current', 0) or getattr(row, 'volume_initial', 0) or 0),
                'entry_price': getattr(row, 'price_open', None), 'sl': getattr(row, 'sl', None), 'tp': getattr(row, 'tp', None),
                'stop_limit_price': getattr(row, 'price_stoplimit', None),
                'time_type': int(getattr(row, 'type_time', getattr(mt5, 'ORDER_TIME_GTC', 0)) or 0),
                'expiration': int(getattr(row, 'time_expiration', 0) or 0),
                'volume_min': getattr(symbol_info, 'volume_min', None), 'volume_max': getattr(symbol_info, 'volume_max', None),
                'volume_step': getattr(symbol_info, 'volume_step', None),
            })
        return {'complete': True, 'account_mode': account_mode, 'positions': result, 'pending_orders': pending_rows}
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
        self.db.execute('CREATE TABLE IF NOT EXISTS copy_pending_state(source_ticket TEXT PRIMARY KEY, follower_order_id TEXT NOT NULL, comment_marker TEXT NOT NULL)')
        pending_columns = {row[1] for row in self.db.execute('PRAGMA table_info(copy_pending_state)')}
        if 'symbol' not in pending_columns:
            self.db.execute('ALTER TABLE copy_pending_state ADD COLUMN symbol TEXT')
        if 'side' not in pending_columns:
            self.db.execute('ALTER TABLE copy_pending_state ADD COLUMN side TEXT')
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

    def follower_pending_rows(self):
        return {str(row[0]): {'source_ticket': str(row[0]), 'ticket': str(row[1]), 'comment_marker': str(row[2]),
                              'symbol': row[3], 'side': row[4]}
                for row in self.db.execute('SELECT source_ticket,follower_order_id,comment_marker,symbol,side FROM copy_pending_state')}

    def record_pending(self, source_ticket, follower_order_id, comment_marker, symbol=None, side=None):
        self.db.execute('INSERT INTO copy_pending_state(source_ticket,follower_order_id,comment_marker,symbol,side) VALUES(?,?,?,?,?) '
                        'ON CONFLICT(source_ticket) DO UPDATE SET follower_order_id=excluded.follower_order_id, comment_marker=excluded.comment_marker, '
                        'symbol=COALESCE(excluded.symbol,copy_pending_state.symbol), side=COALESCE(excluded.side,copy_pending_state.side)',
                        (str(source_ticket), str(follower_order_id or ''), str(comment_marker), symbol, side))
        self.db.commit()

    def remove_pending(self, source_ticket):
        self.db.execute('DELETE FROM copy_pending_state WHERE source_ticket=?', (str(source_ticket),))
        self.db.commit()

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
            pending_rows = journal.follower_pending_rows()
            parent_pending_by_ticket = {str(row.get('ticket')): row for row in parent.get('pending_orders', [])}
            follower_pending_by_ticket = {str(row.get('ticket')): row for row in follower.get('pending_orders', [])}
            follower['pending_orders'] = [{**row, 'source_ticket': next((source for source, linked in pending_rows.items()
                                                                         if linked.get('ticket') == str(row.get('ticket'))), '')}
                                          for row in follower.get('pending_orders', [])]

            # A broker may fill a copied pending order between snapshots. If
            # the resulting follower position retains its unique copy marker,
            # bind it to the sole matching newly-opened parent position. This
            # prevents the market-position reconciler from duplicating a fill.
            used_parent_tickets = {str(row.get('source_ticket') or '') for row in follower.get('positions', []) if row.get('source_ticket')}
            for source_order, linked in pending_rows.items():
                parent_candidates = [row for row in parent.get('positions', [])
                                     if str(row.get('symbol') or '') == str(linked.get('symbol') or '')
                                     and str(row.get('side') or '').upper() == str(linked.get('side') or '').upper()
                                     and str(row.get('ticket') or '') not in used_parent_tickets]
                follower_candidates = [row for row in follower.get('positions', [])
                                       if not row.get('source_ticket') and row.get('comment') == linked.get('comment_marker')]
                if len(parent_candidates) == 1 and len(follower_candidates) == 1:
                    parent_ticket = str(parent_candidates[0].get('ticket'))
                    follower_ticket = str(follower_candidates[0].get('ticket'))
                    follower_candidates[0]['source_ticket'] = parent_ticket
                    journal.record(parent_ticket, follower_ticket, _fingerprint(parent), _positive(parent_candidates[0].get('volume')))
                    used_parent_tickets.add(parent_ticket)
                elif len(parent_candidates) > 1 and follower_candidates:
                    for candidate in parent_candidates:
                        candidate['pending_link_unresolved'] = True
                    for candidate in follower_candidates:
                        candidate['pending_link_unresolved'] = True
                elif not parent_candidates and follower_candidates and source_order not in parent_pending_by_ticket:
                    # The parent canceled/expired the order while a follower
                    # fill raced with cancellation. Close only the position
                    # carrying our unique broker marker.
                    for candidate in follower_candidates:
                        candidate['orphan_pending_source_ticket'] = source_order
            active_follower_order_ids = {str(row.get('ticket')) for row in follower.get('pending_orders', [])}
            open_follower_comments = {str(row.get('comment') or '') for row in follower.get('positions', [])}
            for source_order, linked in pending_rows.items():
                if (source_order not in parent_pending_by_ticket
                        and str(linked.get('ticket')) not in active_follower_order_ids
                        and linked.get('comment_marker') not in open_follower_comments):
                    journal.remove_pending(source_order)
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
                        elif action_type == 'OPEN_PENDING':
                            command = {'action': 'OPEN_POSITION', 'symbol': action['symbol'], 'side': action['side'], 'volume': action['lots'],
                                       'orderType': action['order_type'], 'entryPrice': action['entry_price'],
                                       'stopLoss': action.get('stop_loss'), 'takeProfit': action.get('take_profit'),
                                       'stopLimitPrice': action.get('stop_limit_price'),
                                       'timeType': action.get('time_type'), 'expiration': action.get('expiration')}
                        elif action_type == 'MODIFY_PENDING':
                            command = {'action': 'MODIFY_PENDING', 'orderId': action.get('order_id'),
                                       'entryPrice': action['entry_price'], 'stopLoss': action.get('stop_loss'),
                                       'takeProfit': action.get('take_profit'), 'timeType': action.get('time_type'),
                                       'expiration': action.get('expiration'), 'stopLimitPrice': action.get('stop_limit_price')}
                        elif action_type == 'CANCEL_PENDING':
                            command = {'action': 'CANCEL_PENDING', 'orderId': action.get('order_id')}
                        elif action_type == 'MODIFY_POSITION':
                            command = {'action': 'MODIFY_POSITION', 'positionId': action.get('position_id'), 'stopLoss': action.get('stop_loss'), 'takeProfit': action.get('take_profit')}
                        elif action_type in {'CLOSE_POSITION', 'CLOSE_PENDING_FILL'}:
                            command = {'action': 'CLOSE_POSITION', 'positionId': action.get('position_id')}
                        elif action_type == 'CLOSE_PARTIAL':
                            command = {'action': 'CLOSE_PARTIAL', 'positionId': action.get('position_id'), 'volume': action['lots']}
                        else:
                            continue
                        if action_type == 'OPEN_PENDING':
                            command_id = f'local-copy-pending:{args.parent_profile}:{args.follower_profile}:{source_ticket}'
                        try:
                            result = broker.execute_reconciled(command, command_id)
                        except Exception as exc:
                            print(f'local copier action failed ({action_type}): {exc}', flush=True)
                            # In particular, never follow a failed pending
                            # cancellation with a market open that could
                            # duplicate an order which filled during cancel.
                            if action_type == 'CANCEL_PENDING':
                                break
                            continue
                        if result.get('ok'):
                            if action_type == 'CLOSE_PENDING_FILL':
                                journal.remove_pending(source_ticket)
                            elif action_type == 'CLOSE_POSITION':
                                # A closed source must not be re-emitted on every poll.
                                journal.remove(source_ticket)
                            elif action_type == 'OPEN_PENDING':
                                from mt5_bridge import command_marker
                                source_order = parent_pending_by_ticket.get(str(source_ticket), {})
                                follower_order_id = result.get('order_id') or result.get('ticket')
                                if follower_order_id:
                                    journal.record_pending(source_ticket, follower_order_id,
                                                          command_marker(command_id), source_order.get('symbol'), source_order.get('side'))
                            elif action_type == 'CANCEL_PENDING':
                                journal.remove_pending(source_ticket)
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
