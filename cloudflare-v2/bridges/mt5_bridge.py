import hashlib
import hmac
import json
import os
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


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

    def _symbol(self, name):
        info = self.mt5.symbol_info(name)
        if info is None:
            raise RuntimeError(f'symbol not found: {name}')
        if not getattr(info, 'visible', True) and not self.mt5.symbol_select(name, True):
            raise RuntimeError(f'cannot select symbol: {name}')
        return info

    def _filling_candidates(self, pending=False):
        if pending:
            return [self.mt5.ORDER_FILLING_RETURN]
        return [self.mt5.ORDER_FILLING_IOC, self.mt5.ORDER_FILLING_FOK, self.mt5.ORDER_FILLING_RETURN]

    def _check_and_send(self, request, pending=False):
        last_check = None
        for filling in self._filling_candidates(pending=pending):
            candidate = dict(request)
            candidate['type_filling'] = filling
            check = self.mt5.order_check(candidate)
            last_check = check
            if check is not None and getattr(check, 'retcode', None) == 0:
                result = self.mt5.order_send(candidate)
                if result is None:
                    raise RuntimeError('order_send returned no result')
                accepted = {
                    getattr(self.mt5, 'TRADE_RETCODE_DONE', 10009),
                    getattr(self.mt5, 'TRADE_RETCODE_PLACED', 10008),
                    getattr(self.mt5, 'TRADE_RETCODE_DONE_PARTIAL', 10010),
                }
                if getattr(result, 'retcode', None) not in accepted:
                    raise RuntimeError(f'order_send failed: retcode={getattr(result,"retcode",None)} {getattr(result,"comment","")}')
                return result
        raise RuntimeError(f'order_check failed: retcode={getattr(last_check,"retcode",None)} {getattr(last_check,"comment","")}')

    def _base(self, command_id):
        return {'deviation': self.deviation, 'magic': self.magic, 'comment': f'mkety:{command_id}'[:31], 'type_time': self.mt5.ORDER_TIME_GTC}

    def _open(self, command, command_id):
        symbol = command['symbol']
        self._symbol(symbol)
        side = command['side'].upper()
        order_type = command.get('orderType', 'MARKET').upper()
        volume = float(command['volume'])
        tick = self.mt5.symbol_info_tick(symbol)
        req = {**self._base(command_id), 'symbol': symbol, 'volume': volume}
        if command.get('stopLoss') is not None:
            req['sl'] = float(command['stopLoss'])
        if command.get('takeProfit') is not None:
            req['tp'] = float(command['takeProfit'])

        if order_type == 'MARKET':
            req['action'] = self.mt5.TRADE_ACTION_DEAL
            req['type'] = self.mt5.ORDER_TYPE_BUY if side == 'BUY' else self.mt5.ORDER_TYPE_SELL
            req['price'] = float(tick.ask if side == 'BUY' else tick.bid)
            result = self._check_and_send(req, pending=False)
        else:
            type_map = {
                ('BUY', 'LIMIT'): self.mt5.ORDER_TYPE_BUY_LIMIT,
                ('SELL', 'LIMIT'): self.mt5.ORDER_TYPE_SELL_LIMIT,
                ('BUY', 'STOP'): self.mt5.ORDER_TYPE_BUY_STOP,
                ('SELL', 'STOP'): self.mt5.ORDER_TYPE_SELL_STOP,
            }
            if (side, order_type) not in type_map:
                raise RuntimeError(f'unsupported MT5 pending order type: {side} {order_type}')
            req['action'] = self.mt5.TRADE_ACTION_PENDING
            req['type'] = type_map[(side, order_type)]
            req['price'] = float(command['entryPrice'])
            result = self._check_and_send(req, pending=True)
        return self._result(result)

    def _modify(self, command, command_id):
        request = {**self._base(command_id), 'action': self.mt5.TRADE_ACTION_SLTP, 'position': int(command['positionId'])}
        if command.get('stopLoss') is not None:
            request['sl'] = float(command['stopLoss'])
        if command.get('takeProfit') is not None:
            request['tp'] = float(command['takeProfit'])
        return self._result(self._check_and_send(request))

    def _close(self, command, command_id):
        position_id = int(command['positionId'])
        positions = self.mt5.positions_get(ticket=position_id)
        if not positions:
            raise RuntimeError(f'position not found: {position_id}')
        position = positions[0]
        symbol = position.symbol
        tick = self.mt5.symbol_info_tick(symbol)
        is_buy = int(position.type) == int(self.mt5.ORDER_TYPE_BUY)
        volume = float(command.get('volume') or position.volume)
        request = {
            **self._base(command_id), 'action': self.mt5.TRADE_ACTION_DEAL, 'symbol': symbol,
            'position': position_id, 'volume': volume,
            'type': self.mt5.ORDER_TYPE_SELL if is_buy else self.mt5.ORDER_TYPE_BUY,
            'price': float(tick.bid if is_buy else tick.ask),
        }
        return self._result(self._check_and_send(request))

    def _cancel(self, command, command_id):
        request = {**self._base(command_id), 'action': self.mt5.TRADE_ACTION_REMOVE, 'order': int(command['orderId'])}
        return self._result(self._check_and_send(request, pending=True))

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

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            return self._json(200, {'ok': True})
        if parsed.path == '/v1/account':
            info = self.mt5.account_info()
            return self._json(200, {'ok': info is not None, 'account': info._asdict() if info else None})
        if parsed.path == '/v1/symbols':
            symbols = self.mt5.symbols_get() or []
            return self._json(200, {'ok': True, 'symbols': [symbol_snapshot(item) for item in symbols]})
        if parsed.path == '/v1/tick':
            symbol = parse_qs(parsed.query).get('symbol', [None])[0]
            tick = self.mt5.symbol_info_tick(symbol) if symbol else None
            return self._json(200 if tick else 404, {'ok': bool(tick), 'tick': tick._asdict() if tick else None})
        return self._json(404, {'ok': False, 'error': 'not found'})

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
            result = self.engine.execute(envelope['command'], command_id)
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
