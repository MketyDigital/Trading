import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path


def _repo_bridge_path():
    return Path(__file__).resolve().parents[1] / 'cloudflare-v2' / 'bridges'


if str(_repo_bridge_path()) not in sys.path:
    sys.path.insert(0, str(_repo_bridge_path()))

from mt5_bridge import MT5Engine, ReplayLedger  # noqa: E402

DEFAULT_GATEWAY = 'wss://cbot.mkety.com:25345/v1/mt5'
MAX_SYMBOLS = 2000


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


def symbol_catalog(mt5, limit=MAX_SYMBOLS):
    result = []
    for symbol in (mt5.symbols_get() or ()):
        name = str(getattr(symbol, 'name', '') or '').strip()
        if not name:
            continue
        row = {
            'platformSymbol': name,
            'description': str(getattr(symbol, 'description', '') or '')[:240],
            'tradable': int(getattr(symbol, 'trade_mode', 0) or 0) != int(getattr(mt5, 'SYMBOL_TRADE_MODE_DISABLED', 0)),
            'minVolume': float(getattr(symbol, 'volume_min', 0) or 0),
            'maxVolume': float(getattr(symbol, 'volume_max', 0) or 0),
            'stepVolume': float(getattr(symbol, 'volume_step', 0) or 0),
            'tickSize': float(getattr(symbol, 'trade_tick_size', 0) or getattr(symbol, 'point', 0) or 0),
            'tickValue': float(getattr(symbol, 'trade_tick_value', 0) or 0),
            'digits': int(getattr(symbol, 'digits', 0) or 0),
        }
        result.append(row)
        if len(result) >= int(limit):
            break
    return result


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


class MketyMt5Connector:
    def __init__(self, mt5, websocket_factory, config, ledger_path=None, heartbeat_seconds=20):
        self.mt5 = mt5
        self.websocket_factory = websocket_factory
        self.config = dict(config)
        self.heartbeat_seconds = int(heartbeat_seconds)
        self.identity = terminal_identity(mt5)
        self.catalog = symbol_catalog(mt5)
        self.instance_id = str(self.config.get('connector_instance_id') or uuid.uuid4())
        self.engine = MT5Engine(mt5, magic=460051)
        self.ledger = ReplayLedger(str(ledger_path or default_ledger_path()))

    def auth_message(self):
        return {
            'type': 'auth',
            'connectionToken': self.config['connection_token'],
            **self.identity,
            'terminalName': 'MetaTrader 5',
            'connectorInstanceId': self.instance_id,
            'symbols': self.catalog,
        }

    def execute_envelope(self, envelope):
        command_id = str(envelope.get('command_id') or '')
        broker_account_id = str(envelope.get('broker_account_id') or '')
        expires_at = int(envelope.get('expires_at') or 0)
        if not command_id or not broker_account_id:
            return {'type': 'result', 'commandId': command_id, 'ok': False, 'reason': 'COMMAND_INVALID'}
        if broker_account_id != self.identity['accountNumber']:
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

    def run_forever(self):
        while True:
            socket = None
            try:
                socket = self.websocket_factory(self.config['gateway_url'], timeout=30)
                socket.send(json.dumps(self.auth_message(), separators=(',', ':')))
                while True:
                    raw = socket.recv()
                    if raw is None:
                        raise RuntimeError('Mkety gateway disconnected')
                    message = json.loads(raw)
                    kind = str(message.get('type') or '')
                    if kind == 'auth_ok':
                        print(f"Mkety MT5 Connector connected: account {self.identity['accountNumber']} / {self.identity['serverName']}")
                        continue
                    if kind == 'heartbeat_ack' or kind == 'symbols_ack':
                        continue
                    if kind == 'command':
                        response = self.execute_envelope(message.get('envelope') or {})
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


def main(argv=None):
    args = parse_args(argv)
    config_path = Path(args.config)
    if args.reset and config_path.exists():
        config_path.unlink()
    config = load_local_config(config_path)
    if args.token:
        config = save_local_config(config_path, {
            'gateway_url': args.gateway or DEFAULT_GATEWAY,
            'connection_token': args.token,
            'connector_instance_id': (config or {}).get('connector_instance_id') or str(uuid.uuid4()),
        })
    if not config:
        print('Mkety MT5 pairing is required. Run with --token <token shown in Mkety Trading>.')
        return 2

    import MetaTrader5 as mt5
    import websocket
    if not mt5.initialize():
        raise RuntimeError(f'MT5 initialize failed: {mt5.last_error()}')
    try:
        connector = MketyMt5Connector(mt5, websocket.create_connection, config)
        connector.run_forever()
    finally:
        mt5.shutdown()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
