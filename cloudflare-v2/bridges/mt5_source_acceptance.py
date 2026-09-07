import json
import os
import sys
import time

from mt5_source_capture import MT5SourceCapture
from mt5_source_delivery import create_mt5_signed_v1_delivery as MT5SourceDelivery


REQUIRED = (
    'GATE6_MT5_SOURCE_ENDPOINT',
    'GATE6_MT5_SOURCE_ID',
    'GATE6_MT5_SOURCE_SECRET',
    'GATE6_MT5_ACCOUNT_ID',
)


def _text(value):
    return str(value if value is not None else '').strip()


def _require_environment(env):
    if _text(env.get('BROKER_EXECUTION_ENABLED')).lower() != 'false':
        raise RuntimeError('GATE6_BROKER_EXECUTION_MUST_BE_FALSE')
    missing = [name for name in REQUIRED if not _text(env.get(name))]
    if missing:
        raise RuntimeError('GATE6_SOURCE_CONFIG_MISSING')


def _positive_int(value, fallback, minimum=1000, maximum=3600000):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = fallback
    return max(minimum, min(maximum, number))


def _is_duplicate(result):
    if not isinstance(result, dict):
        return False
    if result.get('duplicate') is True:
        return True
    status = _text(result.get('status')).upper()
    code = _text(result.get('code')).upper()
    return status == 'DUPLICATE' or 'DUPLICATE' in code


def run_gate6_mt5_source_acceptance(env=None, mt5_module=None):
    env = dict(os.environ if env is None else env)
    _require_environment(env)

    if mt5_module is None:
        import MetaTrader5 as mt5_module  # pylint: disable=import-outside-toplevel

    if not callable(getattr(mt5_module, 'initialize', None)):
        raise RuntimeError('GATE6_MT5_RUNTIME_UNAVAILABLE')
    if mt5_module.initialize() is not True:
        raise RuntimeError('GATE6_MT5_INITIALIZE_FAILED')

    try:
        account_id = env['GATE6_MT5_ACCOUNT_ID']
        lookback_ms = _positive_int(env.get('GATE6_MT5_LOOKBACK_MS'), 300000, 5000, 3600000)
        overlap_ms = _positive_int(env.get('GATE6_MT5_OVERLAP_MS'), 5000, 1000, lookback_ms)
        now_ms = int(time.time() * 1000)

        raw_delivery = MT5SourceDelivery(
            endpoint=env['GATE6_MT5_SOURCE_ENDPOINT'],
            source_id=env['GATE6_MT5_SOURCE_ID'],
            source_secret=env['GATE6_MT5_SOURCE_SECRET'],
        )
        first_results = []
        replay_results = []

        def deliver_first(event):
            result = raw_delivery(event)
            first_results.append(result)
            return result

        first = MT5SourceCapture(
            mt5_module,
            deliver_first,
            account_id,
            lookback_ms=lookback_ms,
            overlap_ms=overlap_ms,
        )
        first_poll = first.poll_once(now_ms)
        if first_poll['delivered'] < 1:
            raise RuntimeError('GATE6_MT5_DEAL_HISTORY_EMPTY')

        # Fresh capture intentionally re-reads the same bounded deal-history
        # window. This bypasses the capture instance's in-memory seen set and
        # proves replay convergence at persistent canonical ingress.
        def deliver_replay(event):
            result = raw_delivery(event)
            replay_results.append(result)
            return result

        replay = MT5SourceCapture(
            mt5_module,
            deliver_replay,
            account_id,
            lookback_ms=lookback_ms,
            overlap_ms=overlap_ms,
        )
        replay_poll = replay.poll_once(now_ms)
        if replay_poll['delivered'] < 1:
            raise RuntimeError('GATE6_MT5_REPLAY_EMPTY')
        if not replay_results or not all(_is_duplicate(result) for result in replay_results):
            raise RuntimeError('GATE6_MT5_REPLAY_NOT_DUPLICATE')

        return {
            'ok': True,
            'provider': 'mt5_source_bridge',
            'accountScoped': True,
            'historyDealsDelivered': first_poll['delivered'],
            'replayDealsObserved': replay_poll['delivered'],
            'canonicalReplayDuplicate': True,
            'brokerExecutionEnabled': False,
        }
    finally:
        shutdown = getattr(mt5_module, 'shutdown', None)
        if callable(shutdown):
            shutdown()


def main():
    try:
        print(json.dumps(run_gate6_mt5_source_acceptance(), separators=(',', ':')))
    except Exception as exc:  # sanitized failure only
        reason = _text(exc).split(':', 1)[0] or 'GATE6_MT5_SOURCE_FAILED'
        print(json.dumps({'ok': False, 'reason': reason}, separators=(',', ':')), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
