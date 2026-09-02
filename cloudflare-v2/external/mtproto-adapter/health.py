from datetime import datetime, timezone


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def build_health(
    *,
    status,
    connected,
    last_event_at=None,
    last_message_id=None,
    queue_depth=0,
    delivery_failures=0,
    delivery_successes=0,
    permanent_rejections=0,
    queue_overflows=0,
    last_delivery_error_at=None,
    last_delivery_at=None,
    reconnect_count=0,
):
    """Return secret-free, instance-local external adapter health."""
    return {
        'status': str(status),
        'connected': bool(connected),
        'last_event_at': last_event_at,
        'last_message_id': last_message_id,
        'queue_depth': int(queue_depth or 0),
        'delivery_failures': int(delivery_failures or 0),
        'delivery_successes': int(delivery_successes or 0),
        'permanent_rejections': int(permanent_rejections or 0),
        'queue_overflows': int(queue_overflows or 0),
        'last_delivery_error_at': last_delivery_error_at,
        'last_delivery_at': last_delivery_at,
        'reconnect_count': int(reconnect_count or 0),
    }
