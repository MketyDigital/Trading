import asyncio
import json
from urllib import error as urllib_error
from urllib import request as urllib_request


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


def create_internal_http_sink(*, url, transport_token, transport=None, timeout=3.0):
    endpoint = str(url or '').strip()
    token = str(transport_token or '').strip()
    if not endpoint:
        raise ValueError('internal source URL is required')
    if not token:
        raise ValueError('internal source transport token is required')

    selected_transport = transport or _default_transport
    timeout_seconds = float(timeout)
    if timeout_seconds <= 0:
        raise ValueError('timeout must be positive')

    async def sink(payload):
        body = json.dumps(
            payload,
            separators=(',', ':'),
            ensure_ascii=False,
        ).encode('utf-8')
        headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Mkety-Internal-Source-Token': token,
        }

        status, response_body = await asyncio.to_thread(
            selected_transport,
            url=endpoint,
            body=body,
            headers=headers,
            timeout=timeout_seconds,
        )

        if int(status) < 200 or int(status) >= 300:
            raise RuntimeError(f'Internal source handoff failed with status {int(status)}')

        if not response_body:
            return {}
        try:
            result = json.loads(response_body.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

        if isinstance(result, dict) and result.get('ok') is False:
            raise RuntimeError(f'Internal source handoff rejected with status {int(status)}')
        return result if isinstance(result, dict) else {}

    return sink
