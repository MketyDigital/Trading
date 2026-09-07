from datetime import datetime, timezone


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def build_health(
    *,
    status,
    connected,
    last_event_at=None,
    last_message_id=None,
    restart_count=0,
    queue_depth=0,
    delivery_failures=0,
    delivery_successes=0,
    last_delivery_error_at=None,
    last_delivery_at=None,
):
    """Return the non-secret listener health contract exposed to supervisors."""
    return {
        'status': str(status),
        'connected': bool(connected),
        'last_event_at': last_event_at,
        'last_message_id': last_message_id,
        'restart_count': int(restart_count or 0),
        'queue_depth': int(queue_depth or 0),
        'delivery_failures': int(delivery_failures or 0),
        'delivery_successes': int(delivery_successes or 0),
        'last_delivery_error_at': last_delivery_error_at,
        'last_delivery_at': last_delivery_at,
    }
