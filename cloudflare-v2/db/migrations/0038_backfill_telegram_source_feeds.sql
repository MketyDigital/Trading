BEGIN;

-- Existing Telegram source connections can predate the source_feeds table. The
-- source connection allowlist remains the authorization boundary; this backfill
-- only materializes those already-authorized native chat IDs as independently
-- routable child feeds. It does not create routes or broaden source access.
WITH telegram_sources AS (
  SELECT
    id,
    workspace_id,
    CASE
      WHEN jsonb_typeof(config -> 'allowed_chat_ids') = 'array'
       AND jsonb_typeof(config -> 'chat_ids') = 'array'
        THEN (config -> 'allowed_chat_ids') || (config -> 'chat_ids')
      WHEN jsonb_typeof(config -> 'allowed_chat_ids') = 'array'
        THEN config -> 'allowed_chat_ids'
      WHEN jsonb_typeof(config -> 'chat_ids') = 'array'
        THEN config -> 'chat_ids'
      ELSE '[]'::jsonb
    END AS persisted_chat_ids
  FROM public.source_connections
  WHERE provider_type IN (
    'external_mtproto',
    'cloudflare_container_mtproto',
    'cloudflare_do_mtproto',
    'telegram_bot_api'
  )
), expanded AS (
  SELECT DISTINCT
    source.workspace_id,
    source.id AS source_connection_id,
    trim(chat.provider_feed_id) AS provider_feed_id
  FROM telegram_sources AS source
  CROSS JOIN LATERAL jsonb_array_elements_text(source.persisted_chat_ids) AS chat(provider_feed_id)
  WHERE trim(chat.provider_feed_id) <> ''
)
INSERT INTO public.source_feeds (
  workspace_id,
  source_connection_id,
  provider_feed_id,
  feed_type,
  is_active,
  created_at,
  updated_at
)
SELECT
  workspace_id,
  source_connection_id,
  provider_feed_id,
  'telegram_chat',
  true,
  now(),
  now()
FROM expanded
ON CONFLICT (workspace_id, source_connection_id, provider_feed_id)
DO UPDATE SET
  is_active = true,
  updated_at = EXCLUDED.updated_at;

COMMIT;
