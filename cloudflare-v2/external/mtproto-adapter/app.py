import asyncio
import os

from adapter import ExternalMtprotoAdapter
from v1_sink import create_signed_v1_sink


REQUIRED_ENV = (
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'TELEGRAM_SESSION',
    'TRADING_ENDPOINT',
    'TRADING_SOURCE_ID',
    'TRADING_SOURCE_SECRET',
)


def _parse_allowed_chat_ids(value):
    return {
        item.strip()
        for item in str(value or '').split(',')
        if item.strip()
    }


def load_config(env=None):
    source = os.environ if env is None else env
    missing = [name for name in REQUIRED_ENV if not str(source.get(name, '')).strip()]
    if missing:
        raise ValueError(f"Missing required configuration: {', '.join(missing)}")

    try:
        api_id = int(str(source['TELEGRAM_API_ID']).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError('TELEGRAM_API_ID must be an integer') from exc

    return {
        'api_id': api_id,
        'api_hash': str(source['TELEGRAM_API_HASH']),
        'session_string': str(source['TELEGRAM_SESSION']),
        'trading_endpoint': str(source['TRADING_ENDPOINT']).strip(),
        'source_id': str(source['TRADING_SOURCE_ID']).strip(),
        'source_secret': str(source['TRADING_SOURCE_SECRET']),
        'account_scope': str(source.get('TELEGRAM_ACCOUNT_SCOPE', '')).strip() or None,
        'allowed_chat_ids': _parse_allowed_chat_ids(source.get('ALLOWED_CHAT_IDS', '')),
    }


def build_adapter(config):
    sink = create_signed_v1_sink(
        endpoint=config['trading_endpoint'],
        source_id=config['source_id'],
        source_secret=config['source_secret'],
    )
    return ExternalMtprotoAdapter(
        api_id=config['api_id'],
        api_hash=config['api_hash'],
        session_string=config['session_string'],
        source_id=config['source_id'],
        account_scope=config.get('account_scope'),
        allowed_chat_ids=config.get('allowed_chat_ids'),
        sink=sink,
    )


async def run(config=None):
    adapter = build_adapter(config or load_config())
    await adapter.start()
    try:
        run_until_disconnected = getattr(adapter.client, 'run_until_disconnected', None)
        if run_until_disconnected is None:
            raise RuntimeError('Telegram client cannot run until disconnected')
        await run_until_disconnected()
    finally:
        await adapter.stop(drain=False)


def format_fatal_error(exc):
    """Return operator-safe fatal output without echoing exception details."""
    return f'{type(exc).__name__}: external MTProto adapter stopped'


def main():
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        return
    except Exception as exc:
        raise SystemExit(format_fatal_error(exc)) from None


if __name__ == '__main__':
    main()
