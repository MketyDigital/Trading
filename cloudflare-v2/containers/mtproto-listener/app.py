import asyncio
import json
import os

from http_sink import create_internal_http_sink
from listener import MtprotoListener


def _required_env(name):
    value = str(os.environ.get(name, '')).strip()
    if not value:
        raise RuntimeError(f'{name} is required')
    return value


def _configured_chat_ids():
    raw = _required_env('MTPROTO_CHAT_IDS_JSON')
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError('MTPROTO_CHAT_IDS_JSON must be valid JSON') from exc
    if not isinstance(values, list) or not values:
        raise RuntimeError('MTPROTO_CHAT_IDS_JSON must contain at least one chat id')
    return {str(value) for value in values if str(value).strip()}


async def _health_server(listener):
    async def handle(reader, writer):
        try:
            request_line = await reader.readline()
            path = request_line.decode('latin-1', errors='replace').split(' ')[1] if request_line else '/'
            while True:
                line = await reader.readline()
                if line in (b'\r\n', b'\n', b''):
                    break

            if path == '/health':
                body = json.dumps(listener.health(), separators=(',', ':')).encode('utf-8')
                status = b'200 OK'
            else:
                body = b'{"ok":false,"reason":"NOT_FOUND"}'
                status = b'404 Not Found'

            writer.write(
                b'HTTP/1.1 ' + status + b'\r\n'
                b'Content-Type: application/json; charset=utf-8\r\n'
                b'Cache-Control: no-store\r\n'
                + f'Content-Length: {len(body)}\r\n'.encode('ascii')
                + b'Connection: close\r\n\r\n'
                + body
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    return await asyncio.start_server(handle, host='0.0.0.0', port=8080)


async def main():
    sink = create_internal_http_sink(
        url=_required_env('MTPROTO_INTERNAL_SOURCE_URL'),
        transport_token=_required_env('MTPROTO_INTERNAL_SOURCE_TOKEN'),
    )
    listener = MtprotoListener(
        api_id=int(_required_env('MTPROTO_API_ID')),
        api_hash=_required_env('MTPROTO_API_HASH'),
        session_string=_required_env('MTPROTO_SESSION_STRING'),
        source_id=_required_env('MTPROTO_SOURCE_ID'),
        account_scope=_required_env('MTPROTO_ACCOUNT_SCOPE'),
        configured_chat_ids=_configured_chat_ids(),
        sink=sink,
    )

    server = await _health_server(listener)
    try:
        await listener.start()
        async with server:
            await server.serve_forever()
    finally:
        server.close()
        await server.wait_closed()
        if listener.health()['status'] not in {'IDLE', 'STOPPED'}:
            await listener.stop()


if __name__ == '__main__':
    asyncio.run(main())
