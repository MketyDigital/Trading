import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from pathlib import Path


def _repo_bridge_path():
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        return Path(sys._MEIPASS) / 'cloudflare-v2' / 'bridges'
    return Path(__file__).resolve().parents[1] / 'cloudflare-v2' / 'bridges'


if str(_repo_bridge_path()) not in sys.path:
    sys.path.insert(0, str(_repo_bridge_path()))

from mt5_bridge import MT5Engine  # noqa: E402

DEFAULT_GATEWAY = 'wss://cbot.mkety.com:25345/v1/mt5'
MAX_SYMBOLS = 2000
DEFAULT_HEARTBEAT_SECONDS = 20
DEFAULT_SYMBOL_REFRESH_SECONDS = 15 * 60


class ReplayLedger:
    """Connector-local replay ledger with deterministic SQLite handle ownership."""

    def __init__(self, path):
        self.path = str(path)
        db = sqlite3.connect(self.path)
        try:
            db.execute('CREATE TABLE IF NOT EXISTS commands (command_id TEXT PRIMARY KEY, response_json TEXT NOT NULL, created_at REAL NOT NULL)')
            db.commit()
        finally:
            db.close()

    def get(self, command_id):
        db = sqlite3.connect(self.path)
        try:
            row = db.execute('SELECT response_json FROM commands WHERE command_id=?', (command_id,)).fetchone()
            return json.loads(row[0]) if row else None
        finally:
            db.close()

    def put(self, command_id, response):
        payload = json.dumps(response, separators=(',', ':'), default=str)
        db = sqlite3.connect(self.path)
        try:
            db.execute('INSERT OR REPLACE INTO commands(command_id,response_json,created_at) VALUES(?,?,?)', (command_id, payload, time.time()))
            db.commit()
        finally:
            db.close()


def default_config_path():
    base = Path(os.environ.get('APPDATA') or Path.home() / '.config')
    return base / 'Mkety' / 'mt5-connector.json'


def default_ledger_path():
    return default_config_path().with_name('mt5-connector-ledger.sqlite')


def save_local_config(path, config):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'gateway_url': str(config['gateway_url']),
        'connection_token': str(config['connection_token']),
        'connector_instance_id': str(config.get('connector_instance_id') or uuid.uuid4()),
    }
    target.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    try:
        os.chmod(target, 0o600)
    except OSError:
        pass
    return payload


def load_local_config(path):
    target = Path(path)
    if not target.exists():
        return None
    body = json.loads(target.read_text(encoding='utf-8'))
    if not body.get('gateway_url') or not body.get('connection_token'):
        raise RuntimeError('Mkety connector configuration is incomplete')
    return body


def _finite(value):
    try:
        number = float(value)
        return number if number == number and number not in (float('inf'), float('-inf')) else None
    except (TypeError, ValueError):
        return None


def terminal_identity(mt5):
    info = mt5.account_info()
    if info is None:
        raise RuntimeError('MT5 account is not available; log in to the broker account first')
    login = str(getattr(info, 'login', '') or '')
    server = str(getattr(info, 'server', '') or '')
    if not login or not server:
        raise RuntimeError('MT5 account identity is incomplete')
    real_mode = getattr(mt5, 'ACCOUNT_TRADE_MODE_REAL', 2)
    is_live = int(getattr(info, 'trade_mode', -1)) == int(real_mode)
    return {
        'accountNumber': login,
        'serverName': server,
        'brokerName': str(getattr(info, 'company', '') or '') or None,
        'isLive': is_live,
    }


def _symbol_row(mt5, symbol):
    name = str(getattr(symbol, 'name', '') or '').strip()
    if not name:
        return None
    row = {
        'platformSymbol': name,
        'description': str(getattr(symbol, 'description', '') or '')[:240],
        'tradable': int(getattr(symbol, 'trade_mode', 0) or 0) != int(getattr(mt5, 'SYMBOL_TRADE_MODE_DISABLED', 0)),
        'minVolume': float(getattr(symbol, 'volume_min', 0) or 0),
        'maxVolume': float(getattr(symbol, 'volume_max', 0) or 0),
        'stepVolume': float(getattr(symbol, 'volume_step', 0) or 0),
        'minLots': float(getattr(symbol, 'volume_min', 0) or 0),
        'maxLots': float(getattr(symbol, 'volume_max', 0) or 0),
        'stepLots': float(getattr(symbol, 'volume_step', 0) or 0),
        'tickSize': float(getattr(symbol, 'trade_tick_size', 0) or getattr(symbol, 'point', 0) or 0),
        'tickValue': float(getattr(symbol, 'trade_tick_value', 0) or 0),
        'tickValueLoss': float(getattr(symbol, 'trade_tick_value_loss', 0) or getattr(symbol, 'trade_tick_value', 0) or 0),
        'tickValueProfit': float(getattr(symbol, 'trade_tick_value_profit', 0) or getattr(symbol, 'trade_tick_value', 0) or 0),
        'contractSize': float(getattr(symbol, 'trade_contract_size', 0) or 0),
        'digits': int(getattr(symbol, 'digits', 0) or 0),
    }
    for key, attr in [('currencyBase', 'currency_base'), ('currencyProfit', 'currency_profit'), ('currencyMargin', 'currency_margin')]:
        value = str(getattr(symbol, attr, '') or '').strip()
        if value:
            row[key] = value
    return row


def symbol_catalog(mt5, limit=MAX_SYMBOLS):
    result = []
    for symbol in (mt5.symbols_get() or ()):
        row = _symbol_row(mt5, symbol)
        if row:
            result.append(row)
        if len(result) >= int(limit):
            break
    return result


def terminal_context(mt5, symbol_name):
    account_info = mt5.account_info()
    if account_info is None:
        raise RuntimeError('MT5 account is not available')
    identity = terminal_identity(mt5)
    account = dict(identity)
    for target, attr in [('balance', 'balance'), ('equity', 'equity'), ('marginFree', 'margin_free'), ('leverage', 'leverage')]:
        value = _finite(getattr(account_info, attr, None))
        if value is not None:
            account[target] = value
    currency = str(getattr(account_info, 'currency', '') or '').strip()
    if currency:
        account['currency'] = currency

    requested = str(symbol_name or '').strip()
    if not requested:
        raise RuntimeError('MT5 context symbol is required')
    symbol_info = mt5.symbol_info(requested)
    if symbol_info is None:
        raise RuntimeError('SYMBOL_NOT_FOUND')
    symbol = _symbol_row(mt5, symbol_info)
    if not symbol:
        raise RuntimeError('SYMBOL_NOT_FOUND')
    tick_info = mt5.symbol_info_tick(requested)
    tick = {}
    if tick_info is not None:
        for key in ('ask', 'bid', 'last'):
            value = _finite(getattr(tick_info, key, None))
            if value is not None and value > 0:
                tick[key] = value
    return {'account': account, 'symbol': symbol, 'tick': tick}


def command_result(result):
    return {
        'ok': bool(result.get('ok', True)),
        'positionId': result.get('position_id'),
        'orderId': result.get('order_id'),
        'dealId': result.get('deal_id'),
        'fillPrice': result.get('fill_price'),
        'ticket': result.get('ticket'),
        'retcode': result.get('retcode'),
        'comment': result.get('comment'),
        'recovered': bool(result.get('recovered', False)),
    }


def _is_receive_timeout(exc):
    return isinstance(exc, TimeoutError) or type(exc).__name__ in {'WebSocketTimeoutException', 'TimeoutError'}


class MketyMt5Connector:
    def __init__(self, mt5, websocket_factory, config, ledger_path=None, heartbeat_seconds=DEFAULT_HEARTBEAT_SECONDS,
                 symbol_refresh_seconds=DEFAULT_SYMBOL_REFRESH_SECONDS, config_path=None):
        self.mt5 = mt5
        self.websocket_factory = websocket_factory
        self.config = dict(config)
        self.config_path = Path(config_path) if config_path is not None else None
        self.heartbeat_seconds = max(1, int(heartbeat_seconds))
        self.symbol_refresh_seconds = max(self.heartbeat_seconds, int(symbol_refresh_seconds))
        self.identity = terminal_identity(mt5)
        self.catalog = symbol_catalog(mt5)
        self.instance_id = str(self.config.get('connector_instance_id') or uuid.uuid4())
        self.config['connector_instance_id'] = self.instance_id
        self.engine = MT5Engine(mt5, magic=460051)
        self.ledger = ReplayLedger(str(ledger_path or default_ledger_path()))

    def auth_message(self):
        self.identity = terminal_identity(self.mt5)
        self.catalog = symbol_catalog(self.mt5)
        return {
            'type': 'auth',
            'connectionToken': self.config['connection_token'],
            **self.identity,
            'terminalName': 'MetaTrader 5',
            'connectorInstanceId': self.instance_id,
            'symbols': self.catalog,
        }

    def handle_auth_ok(self, message):
        reconnect_token = str(message.get('reconnectToken') or '').strip()
        if not reconnect_token:
            return False
        self.config['connection_token'] = reconnect_token
        if self.config_path is not None:
            self.config = save_local_config(self.config_path, self.config)
        return True

    def maintenance_messages(self, *, now, last_heartbeat, last_symbols):
        current = float(now)
        heartbeat_at = float(last_heartbeat)
        symbols_at = float(last_symbols)
        messages = []
        if current - heartbeat_at >= self.heartbeat_seconds:
            messages.append({'type': 'heartbeat', 'at': int(time.time() * 1000)})
            heartbeat_at = current
        if current - symbols_at >= self.symbol_refresh_seconds:
            self.catalog = symbol_catalog(self.mt5)
            messages.append({'type': 'symbols', 'symbols': self.catalog})
            symbols_at = current
        return messages, {'last_heartbeat': heartbeat_at, 'last_symbols': symbols_at}

    def execute_envelope(self, envelope):
        command_id = str(envelope.get('command_id') or '')
        broker_account_id = str(envelope.get('broker_account_id') or '')
        expires_at = int(envelope.get('expires_at') or 0)
        if not command_id or not broker_account_id:
            return {'type': 'result', 'commandId': command_id, 'ok': False, 'reason': 'COMMAND_INVALID'}
        current_identity = terminal_identity(self.mt5)
        if broker_account_id != current_identity['accountNumber']:
            return {'type': 'result', 'commandId': command_id, 'ok': False, 'reason': 'MT5_BROKER_ACCOUNT_MISMATCH'}
        if expires_at < int(time.time() * 1000):
            return {'type': 'result', 'commandId': command_id, 'ok': False, 'reason': 'COMMAND_EXPIRED'}
        cached = self.ledger.get(command_id)
        if cached is not None:
            return {'type': 'result', 'commandId': command_id, **command_result(cached), 'duplicate': True}
        try:
            result = self.engine.execute_reconciled(envelope.get('command') or {}, command_id)
            self.ledger.put(command_id, result)
            return {'type': 'result', 'commandId': command_id, **command_result(result)}
        except Exception as exc:
            return {'type': 'result', 'commandId': command_id, 'ok': False, 'reason': str(exc)}

    def handle_message(self, message):
        kind = str(message.get('type') or '')
        if kind == 'command':
            return self.execute_envelope(message.get('envelope') or {})
        if kind == 'context_request':
            request_id = str(message.get('requestId') or '')
            try:
                context = terminal_context(self.mt5, message.get('symbol'))
                return {'type': 'context_result', 'requestId': request_id, 'ok': True, 'context': context}
            except Exception as exc:
                return {'type': 'context_result', 'requestId': request_id, 'ok': False, 'reason': str(exc)}
        return None

    def run_forever(self):
        while True:
            socket = None
            try:
                socket = self.websocket_factory(self.config['gateway_url'], timeout=30)
                if hasattr(socket, 'settimeout'):
                    socket.settimeout(1.0)
                socket.send(json.dumps(self.auth_message(), separators=(',', ':')))
                now = time.monotonic()
                maintenance = {'last_heartbeat': now, 'last_symbols': now}
                while True:
                    messages, maintenance = self.maintenance_messages(now=time.monotonic(), **maintenance)
                    for outbound in messages:
                        socket.send(json.dumps(outbound, separators=(',', ':')))
                    try:
                        raw = socket.recv()
                    except Exception as exc:
                        if _is_receive_timeout(exc):
                            continue
                        raise
                    if raw is None:
                        raise RuntimeError('Mkety gateway disconnected')
                    message = json.loads(raw)
                    kind = str(message.get('type') or '')
                    if kind == 'auth_ok':
                        self.handle_auth_ok(message)
                        print(f"Mkety MT5 Connector connected: account {self.identity['accountNumber']} / {self.identity['serverName']}")
                        continue
                    if kind == 'heartbeat_ack' or kind == 'symbols_ack':
                        continue
                    response = self.handle_message(message)
                    if response is not None:
                        socket.send(json.dumps(response, separators=(',', ':')))
            except KeyboardInterrupt:
                return
            except Exception as exc:
                print(f'Mkety MT5 Connector reconnecting: {type(exc).__name__}')
                time.sleep(3)
            finally:
                if socket is not None:
                    try:
                        socket.close()
                    except Exception:
                        pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Mkety outbound MetaTrader 5 connector')
    parser.add_argument('--gateway', default=None, help=f'Mkety gateway (default {DEFAULT_GATEWAY})')
    parser.add_argument('--token', default=None, help='One-time/pairing connection token from Mkety Trading')
    parser.add_argument('--config', default=str(default_config_path()), help='Local protected connector configuration path')
    parser.add_argument('--reset', action='store_true', help='Forget local connector pairing and require a new token')
    return parser.parse_args(argv)


def resolve_startup_config(args, input_fn=input):
    config_path = Path(args.config)
    if args.reset and config_path.exists():
        config_path.unlink()
    config = load_local_config(config_path)
    if args.token:
        return save_local_config(config_path, {
            'gateway_url': args.gateway or DEFAULT_GATEWAY,
            'connection_token': args.token,
            'connector_instance_id': (config or {}).get('connector_instance_id') or str(uuid.uuid4()),
        })
    if config:
        return config
    token = str(input_fn('Paste the one-time pairing token from Mkety Trading: ') or '').strip()
    if not token:
        return None
    return save_local_config(config_path, {
        'gateway_url': args.gateway or DEFAULT_GATEWAY,
        'connection_token': token,
        'connector_instance_id': str(uuid.uuid4()),
    })


def main(argv=None):
    args = parse_args(argv)
    config = resolve_startup_config(args)
    if not config:
        print('Mkety MT5 pairing token is required.')
        return 2

    import MetaTrader5 as mt5
    import websocket
    if not mt5.initialize():
        raise RuntimeError(f'MT5 initialize failed: {mt5.last_error()}')
    try:
        connector = MketyMt5Connector(mt5, websocket.create_connection, config, config_path=Path(args.config))
        connector.run_forever()
    finally:
        mt5.shutdown()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
