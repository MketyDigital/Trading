import hashlib
import hmac
import json
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


MT5_COMMENT_MAX_LENGTH = 20
MT5_RECONCILIATION_LOOKBACK_DAYS = 7


def command_marker(command_id):
    """Return a deterministic broker-visible command marker that fits restrictive MT5 brokers."""
    digest = hashlib.sha256(str(command_id).encode('utf-8')).hexdigest()
    return f'mkety{digest[:MT5_COMMENT_MAX_LENGTH - len("mkety")]}'


class ReplayLedger:
    def __init__(self, path):
        self.path = path
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, response_json TEXT NOT NULL, created_at REAL NOT NULL)')

    def get(self, command_id):
        with sqlite3.connect(self.path) as db:
            row = db.execute('SELECT response_json FROM commands WHERE command_id=?', (command_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, command_id, response):
        payload = json.dumps(response, separators=(',', ':'), default=str)
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO commands(command_id,response_json,created_at) VALUES(?,?,?)', (command_id, payload, time.time()))


def verify_signature(raw_body, secret, supplied):
    if not secret or not supplied or not supplied.startswith('v1='):
        return False
    expected = 'v1=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, supplied)


def verify_metadata_request(secret, method, target, timestamp, signature, now_ms=None, max_skew_ms=30000):
    if not secret or not timestamp or not signature or not signature.startswith('v1='):
        return False
    try:
        issued_ms = int(timestamp)
        current_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
        skew = int(max_skew_ms)
    except (TypeError, ValueError):
        return False
    if skew < 0 or abs(current_ms - issued_ms) > skew:
        return False
    normalized_method = str(method or '').strip().upper()
    normalized_target = str(target or '').strip()
    if normalized_method != 'GET' or not normalized_target.startswith('/v1/'):
        return False
    payload = f'{normalized_method}\n{normalized_target}\n{timestamp}'.encode('utf-8')
    expected = 'v1=' + hmac.new(secret.encode('utf-8'), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def validate_envelope(envelope, now_ms=None, max_future_skew_ms=30000):
    now_ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
    if envelope.get('version') != 'mkety.mt5.v1':
        return False, 'UNSUPPORTED_VERSION'
    for key in ('command_id', 'workspace_id', 'account_id', 'issued_at', 'expires_at', 'command'):
        if not envelope.get(key):
            return False, 'MISSING_SCOPE_OR_COMMAND'
    issued = int(envelope['issued_at'])
    expires = int(envelope['expires_at'])
    if issued > now_ms + max_future_skew_ms:
        return False, 'ISSUED_IN_FUTURE'
    if expires < now_ms:
        return False, 'EXPIRED'
    return True, None


class MT5Engine:
    def __init__(self, mt5, magic=460051, deviation=20):
        self.mt5 = mt5
        self.magic = int(magic)
        self.deviation = int(deviation)

    @staticmethod
    def _symbol_key(value):
        return ''.join(ch for ch in str(value or '').upper() if ch.isalnum())

    def _symbol(self, name):
        requested = str(name or '').strip()
        info = self.mt5.symbol_info(requested)
        if info is None:
            requested_key = self._symbol_key(requested)
            matches = []
            for candidate in (self.mt5.symbols_get() or ()):
                candidate_name = str(getattr(candidate, 'name', '') or '').strip()
                candidate_key = self._symbol_key(candidate_name)
                if not candidate_name or not requested_key:
                    continue
                if candidate_key == requested_key or candidate_key.startswith(requested_key) or candidate_key.endswith(requested_key):
                    matches.append(candidate)
            if len(matches) == 1:
                info = matches[0]
            elif len(matches) > 1:
                raise RuntimeError(f'symbol resolution ambiguous: {requested}')
        if info is None:
            raise RuntimeError(f'symbol not found: {requested}')
        resolved = str(getattr(info, 'name', '') or requested)
        if not getattr(info, 'visible', True) and not self.mt5.symbol_select(resolved, True):
            raise RuntimeError(f'cannot select symbol: {resolved}')
        return info

    @staticmethod
    def _decimal(value, fallback='0'):
        try:
            return Decimal(str(value))
        except Exception:
            return Decimal(fallback)

    def _normalize_volume(self, value, symbol_info):
        requested = self._decimal(value)
        minimum = self._decimal(getattr(symbol_info, 'volume_min', 0))
        maximum = self._decimal(getattr(symbol_info, 'volume_max', 0))
        step = self._decimal(getattr(symbol_info, 'volume_step', 0))
        if requested <= 0:
            raise RuntimeError('MT5 volume must be positive')
        if minimum > 0 and requested < minimum:
            requested = minimum
        if maximum > 0 and requested > maximum:
            requested = maximum
        if step > 0:
            origin = minimum if minimum > 0 else Decimal('0')
            units = ((requested - origin) / step).to_integral_value(rounding=ROUND_FLOOR)
            requested = origin + max(Decimal('0'), units) * step
            if minimum > 0 and requested < minimum:
                requested = minimum
        return float(requested.normalize())

    def _normalize_price(self, value, symbol_info):
        raw = self._decimal(value)
        tick_size = self._decimal(getattr(symbol_info, 'trade_tick_size', 0) or getattr(symbol_info, 'point', 0))
        if tick_size > 0:
            raw = (raw / tick_size).to_integral_value(rounding=ROUND_HALF_UP) * tick_size
        digits_value = getattr(symbol_info, 'digits', None)
        if digits_value is not None:
            try:
                digits = int(digits_value)
            except (TypeError, ValueError):
                digits = None
            if digits is not None and digits >= 0:
                quantum = Decimal('1').scaleb(-digits)
                raw = raw.quantize(quantum, rounding=ROUND_HALF_UP)
        return float(raw)

    def _filling_candidates(self, symbol_info=None, pending=False):
        if pending:
            return [self.mt5.ORDER_FILLING_RETURN]

        filling_mode = int(getattr(symbol_info, 'filling_mode', 0) or 0)
        candidates = []
        if filling_mode & 2:
            candidates.append(self.mt5.ORDER_FILLING_IOC)
        if filling_mode & 1:
            candidates.append(self.mt5.ORDER_FILLING_FOK)

        if not candidates:
            candidates.extend([self.mt5.ORDER_FILLING_IOC, self.mt5.ORDER_FILLING_FOK])

        market_execution = getattr(self.mt5, 'SYMBOL_TRADE_EXECUTION_MARKET', 2)
        execution_mode = getattr(symbol_info, 'trade_exemode', None)
        if execution_mode != market_execution:
            candidates.append(self.mt5.ORDER_FILLING_RETURN)

        unique = []
        for item in candidates:
            if item not in unique:
                unique.append(item)
        return unique

    def _last_error_text(self):
        try:
            value = self.mt5.last_error()
        except Exception:
            return ''
        if isinstance(value, (tuple, list)) and value:
            code = value[0]
            message = value[1] if len(value) > 1 else ''
            return f' last_error={code} {message}'.rstrip()
        return f' last_error={value}' if value is not None else ''

    def _comment_rejected(self, check):
        detail = f'{getattr(check, "comment", "")}{self._last_error_text()}'.lower()
        return 'comment' in detail and ('invalid' in detail or 'reject' in detail or 'not allowed' in detail)

    def _send_checked(self, candidate):
        result = self.mt5.order_send(candidate)
        if result is None:
            raise RuntimeError(f'order_send returned no result{self._last_error_text()}')
        accepted = {
            getattr(self.mt5, 'TRADE_RETCODE_DONE', 10009),
            getattr(self.mt5, 'TRADE_RETCODE_PLACED', 10008),
            getattr(self.mt5, 'TRADE_RETCODE_DONE_PARTIAL', 10010),
        }
        if getattr(result, 'retcode', None) not in accepted:
            raise RuntimeError(f'order_send failed: retcode={getattr(result,"retcode",None)} {getattr(result,"comment","")}')
        return result

    def _check_and_send(self, request, pending=False, symbol_info=None, use_filling=True):
        last_check = None
        candidates = self._filling_candidates(symbol_info=symbol_info, pending=pending) if use_filling else [None]
        for filling in candidates:
            candidate = dict(request)
            if filling is not None:
                candidate['type_filling'] = filling
            check = self.mt5.order_check(candidate)
            last_check = check
            if check is not None and getattr(check, 'retcode', None) == 0:
                return self._send_checked(candidate)

            if candidate.get('comment') and self._comment_rejected(check):
                commentless = dict(candidate)
                commentless.pop('comment', None)
                fallback_check = self.mt5.order_check(commentless)
                last_check = fallback_check
                if fallback_check is not None and getattr(fallback_check, 'retcode', None) == 0:
                    return self._send_checked(commentless)

        if last_check is None:
            raise RuntimeError(f'order_check failed: retcode=None{self._last_error_text()}')
        raise RuntimeError(f'order_check failed: retcode={getattr(last_check,"retcode",None)} {getattr(last_check,"comment","")}{self._last_error_text()}')

    def _base(self, command_id):
        return {
            'deviation': self.deviation,
            'magic': self.magic,
            'comment': command_marker(command_id),
        }

    def _open(self, command, command_id):
        symbol_info = self._symbol(command['symbol'])
        symbol = str(getattr(symbol_info, 'name', '') or command['symbol'])
        side = command['side'].upper()
        order_type = command.get('orderType', 'MARKET').upper()
        volume = self._normalize_volume(command['volume'], symbol_info)
        tick = self.mt5.symbol_info_tick(symbol)
        if tick is None:
            raise RuntimeError(f'tick unavailable for symbol: {symbol}{self._last_error_text()}')
        req = {**self._base(command_id), 'symbol': symbol, 'volume': volume}
        if command.get('stopLoss') is not None:
            req['sl'] = self._normalize_price(command['stopLoss'], symbol_info)
        if command.get('takeProfit') is not None:
            req['tp'] = self._normalize_price(command['takeProfit'], symbol_info)

        if order_type == 'MARKET':
            req['action'] = self.mt5.TRADE_ACTION_DEAL
            req['type'] = self.mt5.ORDER_TYPE_BUY if side == 'BUY' else self.mt5.ORDER_TYPE_SELL
            req['price'] = self._normalize_price(tick.ask if side == 'BUY' else tick.bid, symbol_info)
            result = self._check_and_send(req, pending=False, symbol_info=symbol_info)
        else:
            type_map = {
                ('BUY', 'LIMIT'): self.mt5.ORDER_TYPE_BUY_LIMIT,
                ('SELL', 'LIMIT'): self.mt5.ORDER_TYPE_SELL_LIMIT,
                ('BUY', 'STOP'): self.mt5.ORDER_TYPE_BUY_STOP,
                ('SELL', 'STOP'): self.mt5.ORDER_TYPE_SELL_STOP,
            }
            buy_stop_limit = getattr(self.mt5, 'ORDER_TYPE_BUY_STOP_LIMIT', None)
            sell_stop_limit = getattr(self.mt5, 'ORDER_TYPE_SELL_STOP_LIMIT', None)
            if buy_stop_limit is not None:
                type_map[('BUY', 'STOP_LIMIT')] = buy_stop_limit
            if sell_stop_limit is not None:
                type_map[('SELL', 'STOP_LIMIT')] = sell_stop_limit
            if (side, order_type) not in type_map:
                raise RuntimeError(f'unsupported MT5 pending order type: {side} {order_type}')
            req['action'] = self.mt5.TRADE_ACTION_PENDING
            req['type'] = type_map[(side, order_type)]
            req['price'] = self._normalize_price(command['entryPrice'], symbol_info)
            req['type_time'] = self.mt5.ORDER_TIME_GTC
            result = self._check_and_send(req, pending=True, symbol_info=symbol_info)
        return self._result(result)

    def _already_closed(self, position_id):
        return {
            'ok': True,
            'ticket': None,
            'position_id': int(position_id),
            'order_id': None,
            'deal_id': None,
            'fill_price': None,
            'retcode': None,
            'comment': 'position already closed',
            'recovered': True,
            'reconciled_closed': True,
            'position_closed': True,
        }

    def _modify(self, command, command_id):
        position_id = int(command['positionId'])
        symbol_info = None
        try:
            positions = self.mt5.positions_get(ticket=position_id)
            if positions is None:
                raise RuntimeError(f'MT5_RECONCILIATION_UNCERTAIN:positions{self._last_error_text()}')
            if not positions:
                return self._already_closed(position_id)
            symbol_info = self._symbol(getattr(positions[0], 'symbol', ''))
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError('MT5_RECONCILIATION_UNCERTAIN:positions') from exc
        request = {'action': self.mt5.TRADE_ACTION_SLTP, 'position': position_id}
        if command.get('stopLoss') is not None:
            request['sl'] = self._normalize_price(command['stopLoss'], symbol_info) if symbol_info is not None else float(command['stopLoss'])
        if command.get('takeProfit') is not None:
            request['tp'] = self._normalize_price(command['takeProfit'], symbol_info) if symbol_info is not None else float(command['takeProfit'])
        return self._result(self._check_and_send(request, use_filling=False))

    def _close(self, command, command_id):
        position_id = int(command['positionId'])
        positions = self.mt5.positions_get(ticket=position_id)
        if positions is None:
            raise RuntimeError(f'MT5_RECONCILIATION_UNCERTAIN:positions{self._last_error_text()}')
        if not positions:
            return self._already_closed(position_id)
        position = positions[0]
        symbol_info = self._symbol(position.symbol)
        symbol = str(getattr(symbol_info, 'name', '') or position.symbol)
        tick = self.mt5.symbol_info_tick(symbol)
        if tick is None:
            raise RuntimeError(f'tick unavailable for symbol: {symbol}{self._last_error_text()}')
        is_buy = int(position.type) == int(self.mt5.ORDER_TYPE_BUY)
        requested_volume = float(command.get('volume') or position.volume)
        requested_volume = min(requested_volume, float(position.volume))
        volume = self._normalize_volume(requested_volume, symbol_info)
        if volume > float(position.volume):
            volume = float(position.volume)
        request = {
            **self._base(command_id), 'action': self.mt5.TRADE_ACTION_DEAL, 'symbol': symbol,
            'position': position_id, 'volume': volume,
            'type': self.mt5.ORDER_TYPE_SELL if is_buy else self.mt5.ORDER_TYPE_BUY,
            'price': self._normalize_price(tick.bid if is_buy else tick.ask, symbol_info),
        }
        return self._result(self._check_and_send(request, symbol_info=symbol_info))

    def _cancel(self, command, command_id):
        request = {'action': self.mt5.TRADE_ACTION_REMOVE, 'order': int(command['orderId'])}
        return self._result(self._check_and_send(request, use_filling=False))

    def _result(self, result):
        order = getattr(result, 'order', None)
        deal = getattr(result, 'deal', None)
        return {
            'ok': True,
            'ticket': order or deal,
            'position_id': order or None,
            'order_id': order or None,
            'deal_id': deal or None,
            'fill_price': getattr(result, 'price', None),
            'retcode': getattr(result, 'retcode', None),
            'comment': getattr(result, 'comment', None),
        }

    def _matching_records(self, records, marker):
        matches = []
        for record in records:
            if str(getattr(record, 'comment', '')) != marker:
                continue
            if int(getattr(record, 'magic', -1)) != self.magic:
                continue
            matches.append(record)
        return matches

    def _query_reconciliation_records(self):
        now = datetime.now(timezone.utc)
        start = now - timedelta(days=MT5_RECONCILIATION_LOOKBACK_DAYS)
        queries = (
            ('orders', lambda: self.mt5.orders_get()),
            ('positions', lambda: self.mt5.positions_get()),
            ('history_orders', lambda: self.mt5.history_orders_get(start, now)),
            ('history_deals', lambda: self.mt5.history_deals_get(start, now)),
        )
        results = {}
        for name, query in queries:
            try:
                records = query()
            except Exception as exc:
                raise RuntimeError(f'MT5_RECONCILIATION_UNCERTAIN:{name}') from exc
            if records is None:
                raise RuntimeError(f'MT5_RECONCILIATION_UNCERTAIN:{name}')
            results[name] = tuple(records)
        return results

    def _normalized_recovered_deal(self, deal):
        return {
            'ok': True,
            'ticket': getattr(deal, 'order', None) or getattr(deal, 'ticket', None),
            'position_id': getattr(deal, 'position_id', None),
            'order_id': getattr(deal, 'order', None),
            'deal_id': getattr(deal, 'ticket', None),
            'fill_price': getattr(deal, 'price', None),
            'retcode': None,
            'comment': 'recovered from broker history',
            'recovered': True,
        }

    def _normalized_recovered_order(self, order):
        order_id = getattr(order, 'ticket', None) or getattr(order, 'order', None)
        position_id = getattr(order, 'position_id', None) or None
        price = getattr(order, 'price_open', None)
        if price is None:
            price = getattr(order, 'price_current', None)
        return {
            'ok': True,
            'ticket': order_id,
            'position_id': position_id,
            'order_id': order_id,
            'deal_id': None,
            'fill_price': price,
            'retcode': None,
            'comment': 'recovered from broker order state',
            'recovered': True,
        }

    def _normalized_recovered_position(self, position):
        position_id = getattr(position, 'ticket', None) or getattr(position, 'position_id', None)
        return {
            'ok': True,
            'ticket': position_id,
            'position_id': position_id,
            'order_id': None,
            'deal_id': None,
            'fill_price': getattr(position, 'price_open', None),
            'retcode': None,
            'comment': 'recovered from broker position state',
            'recovered': True,
        }

    def _unique_recovery(self, normalized):
        if not normalized:
            return None
        identities = {
            (
                str(item.get('position_id')) if item.get('position_id') is not None else None,
                str(item.get('order_id')) if item.get('order_id') is not None else None,
                str(item.get('deal_id')) if item.get('deal_id') is not None else None,
            )
            for item in normalized
        }
        if len(identities) != 1:
            raise RuntimeError('MT5_RECONCILIATION_AMBIGUOUS')
        return normalized[0]

    def reconcile_open(self, command_id):
        marker = command_marker(command_id)
        records = self._query_reconciliation_records()

        deals = [self._normalized_recovered_deal(item) for item in self._matching_records(records['history_deals'], marker)]
        recovered = self._unique_recovery(deals)
        if recovered is not None:
            return recovered

        order_records = self._matching_records(records['orders'], marker) + self._matching_records(records['history_orders'], marker)
        orders = [self._normalized_recovered_order(item) for item in order_records]
        recovered = self._unique_recovery(orders)
        if recovered is not None:
            return recovered

        positions = [self._normalized_recovered_position(item) for item in self._matching_records(records['positions'], marker)]
        return self._unique_recovery(positions)

    def execute_reconciled(self, command, command_id):
        action = command.get('action')
        if action == 'OPEN_POSITION':
            recovered = self.reconcile_open(command_id)
            if recovered is not None:
                return recovered
        return self.execute(command, command_id)

    def execute(self, command, command_id):
        action = command.get('action')
        if action == 'OPEN_POSITION':
            return self._open(command, command_id)
        if action == 'MODIFY_POSITION':
            return self._modify(command, command_id)
        if action in ('CLOSE_POSITION', 'CLOSE_PARTIAL'):
            return self._close(command, command_id)
        if action == 'CANCEL_PENDING':
            return self._cancel(command, command_id)
        raise RuntimeError(f'unsupported command action: {action}')


def symbol_snapshot(info):
    keys = ('name', 'description', 'digits', 'trade_tick_size', 'trade_tick_value', 'trade_tick_value_loss', 'trade_contract_size', 'volume_min', 'volume_max', 'volume_step', 'currency_base', 'currency_profit', 'currency_margin', 'trade_exemode', 'filling_mode')
    return {key: getattr(info, key, None) for key in keys}


class BridgeHandler(BaseHTTPRequestHandler):
    engine = None
    ledger = None
    mt5 = None
    secret = None
    account_id = None

    def _json(self, status, data):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _metadata_authorized(self):
        return verify_metadata_request(
            secret=self.secret,
            method='GET',
            target=self.path,
            timestamp=self.headers.get('X-Mkety-Timestamp'),
            signature=self.headers.get('X-Mkety-Signature'),
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            return self._json(200, {'ok': True})
        if parsed.path not in ('/v1/health', '/v1/account', '/v1/symbols', '/v1/tick'):
            return self._json(404, {'ok': False, 'error': 'not found'})
        if not self._metadata_authorized():
            return self._json(401, {'ok': False, 'error': 'invalid metadata signature'})
        if parsed.path == '/v1/health':
            return self._json(200, {'ok': True})
        if parsed.path == '/v1/account':
            info = self.mt5.account_info()
            return self._json(200, {'ok': info is not None, 'account': info._asdict() if info else None})
        if parsed.path == '/v1/symbols':
            symbols = self.mt5.symbols_get() or []
            return self._json(200, {'ok': True, 'symbols': [symbol_snapshot(item) for item in symbols]})
        symbol = parse_qs(parsed.query).get('symbol', [None])[0]
        tick = self.mt5.symbol_info_tick(symbol) if symbol else None
        return self._json(200 if tick else 404, {'ok': bool(tick), 'tick': tick._asdict() if tick else None})

    def do_POST(self):
        if self.path != '/v1/command':
            return self._json(404, {'ok': False, 'error': 'not found'})
        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length)
        if not verify_signature(raw, self.secret, self.headers.get('X-Mkety-Signature')):
            return self._json(401, {'ok': False, 'error': 'invalid signature'})
        try:
            envelope = json.loads(raw)
            valid, reason = validate_envelope(envelope)
            if not valid:
                return self._json(400, {'ok': False, 'error': reason})
            if str(envelope['account_id']) != str(self.account_id):
                return self._json(403, {'ok': False, 'error': 'account scope mismatch'})
            command_id = envelope['command_id']
            cached = self.ledger.get(command_id)
            if cached is not None:
                return self._json(200, {**cached, 'duplicate': True})
            result = self.engine.execute_reconciled(envelope['command'], command_id)
            self.ledger.put(command_id, result)
            return self._json(200, result)
        except Exception as exc:
            return self._json(409, {'ok': False, 'error': str(exc)})

    def log_message(self, fmt, *args):
        print('[mt5-bridge]', fmt % args)


def main():
    import MetaTrader5 as mt5
    secret = os.environ['MKETY_MT5_BRIDGE_SECRET']
    account_id = os.environ.get('MKETY_MT5_ACCOUNT_ID', '')
    ledger_path = os.environ.get('MKETY_MT5_LEDGER', 'mkety_mt5_bridge.sqlite')
    host = os.environ.get('MKETY_MT5_HOST', '127.0.0.1')
    port = int(os.environ.get('MKETY_MT5_PORT', '8789'))
    if not mt5.initialize():
        raise RuntimeError(f'MT5 initialize failed: {mt5.last_error()}')
    if account_id and str(mt5.account_info().login) != str(account_id):
        raise RuntimeError('connected MT5 account does not match MKETY_MT5_ACCOUNT_ID')
    BridgeHandler.mt5 = mt5
    BridgeHandler.engine = MT5Engine(mt5, magic=int(os.environ.get('MKETY_MT5_MAGIC', '460051')))
    BridgeHandler.ledger = ReplayLedger(ledger_path)
    BridgeHandler.secret = secret
    BridgeHandler.account_id = account_id or str(mt5.account_info().login)
    server = ThreadingHTTPServer((host, port), BridgeHandler)
    print(f'Mkety MT5 bridge listening on http://{host}:{port}')
    try:
        server.serve_forever()
    finally:
        mt5.shutdown()


if __name__ == '__main__':
    main()
