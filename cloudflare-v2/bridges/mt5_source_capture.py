from collections import deque
from datetime import datetime, timezone


SAFE_DEAL_FIELDS = (
    'ticket',
    'order',
    'position_id',
    'time_msc',
    'type',
    'entry',
    'symbol',
    'volume',
    'price',
    'commission',
    'swap',
    'profit',
    'fee',
    'reason',
)


def _required_account_id(value):
    normalized = str(value if value is not None else '').strip()
    if not normalized:
        raise ValueError('MT5_SOURCE_ACCOUNT_REQUIRED')
    return normalized


def _positive_int(value, code):
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(code)
    return parsed


def _nonnegative_int(value, code):
    parsed = int(value)
    if parsed < 0:
        raise ValueError(code)
    return parsed


def _deal_event(deal):
    ticket = str(getattr(deal, 'ticket', '') or '').strip()
    try:
        time_msc = int(getattr(deal, 'time_msc'))
    except (TypeError, ValueError):
        return None
    if not ticket or time_msc <= 0:
        return None

    occurred_at = datetime.fromtimestamp(time_msc / 1000, tz=timezone.utc).isoformat()
    payload = {field: getattr(deal, field, None) for field in SAFE_DEAL_FIELDS}
    return {
        'providerType': 'mt5_source_bridge',
        'nativeEventId': ticket,
        'occurredAt': occurred_at,
        'structuredPayload': payload,
        'metadata': {'native_kind': 'deal'},
    }


class MT5SourceCapture:
    def __init__(self, mt5, deliver, account_id, lookback_ms=5000, overlap_ms=1000, max_seen=10000):
        if mt5 is None or not callable(getattr(mt5, 'account_info', None)) or not callable(getattr(mt5, 'history_deals_get', None)):
            raise ValueError('MT5_SOURCE_RUNTIME_REQUIRED')
        if not callable(deliver):
            raise ValueError('MT5_SOURCE_DELIVER_REQUIRED')

        self._mt5 = mt5
        self._deliver = deliver
        self._account_id = _required_account_id(account_id)
        self._lookback_ms = _positive_int(lookback_ms, 'MT5_SOURCE_LOOKBACK_INVALID')
        self._overlap_ms = _nonnegative_int(overlap_ms, 'MT5_SOURCE_OVERLAP_INVALID')
        self._max_seen = _positive_int(max_seen, 'MT5_SOURCE_MAX_SEEN_INVALID')

        self._seen = set()
        self._seen_order = deque()
        self._last_poll_until_ms = None
        self._state = {
            'status': 'idle',
            'polls': 0,
            'observedEvents': 0,
            'ignoredEvents': 0,
            'deliveredEvents': 0,
            'failedEvents': 0,
            'lastNativeEventId': None,
        }

    def status(self):
        return dict(self._state)

    def _assert_account_scope(self):
        account = self._mt5.account_info()
        actual = str(getattr(account, 'login', '') if account is not None else '').strip()
        if not actual or actual != self._account_id:
            self._state['status'] = 'degraded'
            raise RuntimeError('MT5_SOURCE_ACCOUNT_MISMATCH')

    def _remember_seen(self, native_event_id):
        if native_event_id in self._seen:
            return
        self._seen.add(native_event_id)
        self._seen_order.append(native_event_id)
        while len(self._seen_order) > self._max_seen:
            expired = self._seen_order.popleft()
            self._seen.discard(expired)

    def poll_once(self, now_ms):
        now_ms = int(now_ms)
        self._assert_account_scope()

        if self._last_poll_until_ms is None:
            start_ms = now_ms - self._lookback_ms
        else:
            start_ms = self._last_poll_until_ms - self._overlap_ms
        end_ms = now_ms
        if start_ms > end_ms:
            raise RuntimeError('MT5_SOURCE_POLL_WINDOW_INVALID')

        start = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
        end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)
        deals = self._mt5.history_deals_get(start, end) or ()
        self._last_poll_until_ms = end_ms
        self._state['polls'] += 1

        observed = 0
        ignored = 0
        delivered = 0
        failed = 0
        candidates = []

        for deal in deals:
            observed += 1
            event = _deal_event(deal)
            if event is None:
                ignored += 1
                continue
            candidates.append((int(event['structuredPayload']['time_msc']), event['nativeEventId'], event))

        candidates.sort(key=lambda item: (item[0], item[1]))
        attempted_this_poll = set()
        for _time_msc, native_event_id, event in candidates:
            if native_event_id in self._seen or native_event_id in attempted_this_poll:
                ignored += 1
                continue
            attempted_this_poll.add(native_event_id)
            self._state['lastNativeEventId'] = native_event_id
            try:
                self._deliver(event)
            except Exception:
                failed += 1
                self._state['failedEvents'] += 1
                self._state['status'] = 'degraded'
                continue

            delivered += 1
            self._state['deliveredEvents'] += 1
            self._state['status'] = 'healthy'
            self._remember_seen(native_event_id)

        self._state['observedEvents'] += observed
        self._state['ignoredEvents'] += ignored
        if observed == 0 and self._state['status'] == 'idle':
            self._state['status'] = 'healthy'

        return {
            'observed': observed,
            'ignored': ignored,
            'delivered': delivered,
            'failed': failed,
        }
