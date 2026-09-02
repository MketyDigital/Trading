import hashlib
import hmac
import json
import time
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request


class MT5SourceDeliveryError(RuntimeError):
    def __init__(self, code, *, status=None, retryable=False):
        self.code = str(code)
        self.status = int(status) if status is not None else None
        self.retryable = bool(retryable)
        suffix = f' status={self.status}' if self.status is not None else ''
        super().__init__(f'MT5 source delivery failed: {self.code}{suffix}')


_BLOCKED_KEY_FRAGMENTS = (
    'secret',
    'token',
    'password',
    'credential',
    'workspace',
    'source_connection',
    'account_id',
    'accountid',
    'broker_secret',
    'execution_enabled',
)


def _default_transport(*, url, body, headers, timeout):
    request = urllib_request.Request(url, data=body, headers=headers, method='POST')
    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            return int(response.status), response.read()
    except urllib_error.HTTPError as exc:
        return int(exc.code), exc.read()


def _safe_key(key):
    lowered = str(key).lower()
    return not any(fragment in lowered for fragment in _BLOCKED_KEY_FRAGMENTS)


def _sanitize(value):
    if isinstance(value, dict):
        return {str(key): _sanitize(item) for key, item in value.items() if _safe_key(key)}
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize(item) for item in value]
    return value


def _build_v1_event(source_event):
    if not isinstance(source_event, dict):
        raise MT5SourceDeliveryError('INVALID_SOURCE_EVENT')
    if source_event.get('providerType') != 'mt5_source_bridge':
        raise MT5SourceDeliveryError('PROVIDER_MISMATCH')

    native_event_id = str(source_event.get('nativeEventId') or '').strip()
    occurred_at = str(source_event.get('occurredAt') or '').strip()
    structured = source_event.get('structuredPayload')
    if not native_event_id or not occurred_at or not isinstance(structured, dict):
        raise MT5SourceDeliveryError('INVALID_SOURCE_EVENT')

    metadata = {'native_identity': {'transaction_id': native_event_id}}
    supplied_metadata = source_event.get('metadata')
    if isinstance(supplied_metadata, dict):
        metadata.update(_sanitize(supplied_metadata))
    metadata['native_identity'] = {'transaction_id': native_event_id}

    return {
        'external_event_id': native_event_id,
        'occurred_at': occurred_at,
        'metadata': metadata,
        'structured_payload': _sanitize(structured),
    }


def _serialize_v1_event(source_event):
    try:
        return json.dumps(
            _build_v1_event(source_event),
            separators=(',', ':'),
            ensure_ascii=False,
            sort_keys=True,
        ).encode('utf-8')
    except MT5SourceDeliveryError:
        raise
    except (TypeError, ValueError) as exc:
        raise MT5SourceDeliveryError('INVALID_SOURCE_EVENT') from exc


def _signature(raw_body, timestamp, secret):
    basis = b'v1:' + timestamp.encode('ascii') + b':' + raw_body
    return 'v1=' + hmac.new(secret.encode('utf-8'), basis, hashlib.sha256).hexdigest()


def _parse_success(response_body):
    if not response_body:
        raise MT5SourceDeliveryError('INVALID_RESPONSE')
    try:
        decoded = response_body.decode('utf-8') if isinstance(response_body, (bytes, bytearray)) else str(response_body)
        result = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise MT5SourceDeliveryError('INVALID_RESPONSE') from exc
    if not isinstance(result, dict) or result.get('ok') is not True:
        raise MT5SourceDeliveryError('INVALID_RESPONSE')
    return result


def create_mt5_signed_v1_delivery(
    *,
    endpoint,
    source_id,
    source_secret,
    transport=None,
    timeout=3.0,
    retry_delays=(0.25, 1.0, 3.0),
    sleep=None,
    now_ms=None,
):
    target = str(endpoint or '').strip()
    source = str(source_id or '').strip()
    secret = str(source_secret or '')
    if not target:
        raise ValueError('endpoint is required')
    if not source:
        raise ValueError('source_id is required')
    if not secret:
        raise ValueError('source_secret is required')

    parsed = urllib_parse.urlparse(target)
    if parsed.scheme.lower() != 'https' or parsed.path != '/api/v1/events' or parsed.params or parsed.query or parsed.fragment:
        raise ValueError('endpoint must be an exact HTTPS /api/v1/events URL')

    timeout_seconds = float(timeout)
    if timeout_seconds <= 0:
        raise ValueError('timeout must be positive')

    delays = tuple(float(delay) for delay in retry_delays)
    if any(delay < 0 for delay in delays):
        raise ValueError('retry delays must be nonnegative')

    selected_transport = transport or _default_transport
    sleeper = sleep or time.sleep
    clock = now_ms or (lambda: int(time.time() * 1000))

    def deliver(source_event):
        raw_body = _serialize_v1_event(source_event)
        attempt = 0

        while True:
            timestamp = str(int(clock()))
            headers = {
                'Content-Type': 'application/json; charset=utf-8',
                'X-Mkety-Source-Id': source,
                'X-Mkety-Timestamp': timestamp,
                'X-Mkety-Signature': _signature(raw_body, timestamp, secret),
            }

            try:
                status, response_body = selected_transport(
                    url=target,
                    body=raw_body,
                    headers=headers,
                    timeout=timeout_seconds,
                )
            except Exception:
                if attempt < len(delays):
                    sleeper(delays[attempt])
                    attempt += 1
                    continue
                raise MT5SourceDeliveryError('NETWORK_ERROR', retryable=True) from None

            try:
                status_code = int(status)
            except (TypeError, ValueError):
                raise MT5SourceDeliveryError('INVALID_RESPONSE_STATUS') from None

            retryable = status_code == 429 or 500 <= status_code <= 599
            if retryable:
                if attempt < len(delays):
                    sleeper(delays[attempt])
                    attempt += 1
                    continue
                raise MT5SourceDeliveryError(f'HTTP_{status_code}', status=status_code, retryable=True)

            if status_code < 200 or status_code >= 300:
                raise MT5SourceDeliveryError(f'HTTP_{status_code}', status=status_code)

            return _parse_success(response_body)

    return deliver
