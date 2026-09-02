import asyncio
import hashlib
import hmac
import json
import time
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request


class V1DeliveryError(RuntimeError):
    def __init__(self, code, *, status=None):
        self.code = str(code)
        self.status = int(status) if status is not None else None
        suffix = f' status={self.status}' if self.status is not None else ''
        super().__init__(f'V1 delivery failed: {self.code}{suffix}')


class RetryableV1DeliveryError(V1DeliveryError):
    pass


class PermanentV1DeliveryError(V1DeliveryError):
    pass


def _default_transport(*, url, body, headers, timeout):
    request = urllib_request.Request(
        url,
        data=body,
        headers=headers,
        method='POST',
    )
    try:
        with urllib_request.urlopen(request, timeout=timeout) as response:
            return int(response.status), response.read()
    except urllib_error.HTTPError as exc:
        return int(exc.code), exc.read()


def _serialize_event(event):
    try:
        return json.dumps(
            event,
            separators=(',', ':'),
            ensure_ascii=False,
            sort_keys=True,
        ).encode('utf-8')
    except (TypeError, ValueError) as exc:
        raise PermanentV1DeliveryError('INVALID_EVENT') from exc


def _signature(raw_body, timestamp, secret):
    basis = b'v1:' + timestamp.encode('ascii') + b':' + raw_body
    digest = hmac.new(secret.encode('utf-8'), basis, hashlib.sha256).hexdigest()
    return f'v1={digest}'


def _parse_success_response(response_body):
    if not response_body:
        raise PermanentV1DeliveryError('INVALID_RESPONSE')
    try:
        decoded = response_body.decode('utf-8') if isinstance(response_body, (bytes, bytearray)) else str(response_body)
        result = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise PermanentV1DeliveryError('INVALID_RESPONSE') from exc

    if not isinstance(result, dict) or result.get('ok') is not True:
        raise PermanentV1DeliveryError('INVALID_RESPONSE')
    return result


def create_signed_v1_sink(*, endpoint, source_id, source_secret, transport=None, timeout=3.0, now_ms=None):
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
    if parsed.scheme.lower() != 'https' or parsed.path != '/api/v1/events':
        raise ValueError('endpoint must be an HTTPS /api/v1/events URL')

    timeout_seconds = float(timeout)
    if timeout_seconds <= 0:
        raise ValueError('timeout must be positive')

    selected_transport = transport or _default_transport
    clock = now_ms or (lambda: int(time.time() * 1000))

    async def sink(event):
        raw_body = _serialize_event(event)
        timestamp = str(int(clock()))
        headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Mkety-Source-Id': source,
            'X-Mkety-Timestamp': timestamp,
            'X-Mkety-Signature': _signature(raw_body, timestamp, secret),
        }

        try:
            status, response_body = await asyncio.to_thread(
                selected_transport,
                url=target,
                body=raw_body,
                headers=headers,
                timeout=timeout_seconds,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise RetryableV1DeliveryError('NETWORK_ERROR') from exc

        try:
            status_code = int(status)
        except (TypeError, ValueError) as exc:
            raise PermanentV1DeliveryError('INVALID_RESPONSE_STATUS') from exc

        if status_code == 429 or 500 <= status_code <= 599:
            raise RetryableV1DeliveryError(f'HTTP_{status_code}', status=status_code)
        if status_code < 200 or status_code >= 300:
            raise PermanentV1DeliveryError(f'HTTP_{status_code}', status=status_code)

        return _parse_success_response(response_body)

    return sink
