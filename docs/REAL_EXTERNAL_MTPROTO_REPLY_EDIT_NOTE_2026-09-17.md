# External MTProto bridge compatibility checkpoint — 2026-09-17

The production external Telethon bridge is a separate upstream system. Mkety must not replace or restructure that listener.

Observed upstream payload contract:
- `text`
- `chat_id`
- `chat_title`
- `message_id`
- `reply_to_id`
- `account_id`

Compatibility requirement:
- Mkety collector normalizes `reply_to_id` into canonical `thread.reply_to_event_id = telegram:<chat_id>:<reply_to_id>`.
- If the upstream bridge later sends an additive edit marker (`edited`, `is_edited`, or `edit_date`) for the same Telegram `chat_id + message_id`, Mkety normalizes it to canonical `thread.edited_event_id = telegram:<chat_id>:<message_id>`.
- Existing external bridge multi-account, multi-endpoint, catch-up, retry, dedupe, NewMessage handling and payload fields remain intact.
- A message copied into an authorized source channel is a valid Mkety source message regardless of its earlier origin. Only the Telegram metadata on the configured source channel is authoritative for downstream reply/edit lineage.
- LIVE remains disabled until real production DEMO traffic proves source, reply, edit, destination and broker behavior.
