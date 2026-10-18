-- Dedicated Trading domain schema generated from the read-only 2026-10-17 production metadata snapshot.

-- SQLite affinity differences are intentional: UUID/time values are TEXT, booleans INTEGER, JSON/arrays validated TEXT, numerics TEXT.

-- Application repositories must generate UUIDs and enforce trade_accounts connected-DEMO policy before writes.

CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "owner_email" TEXT NOT NULL,
  "custom_domain" TEXT,
  "tier" TEXT DEFAULT 'free',
  "tg_admin_chat_id" INTEGER,
  "tg_vip_chat_id" INTEGER,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "tg_bot_token_ciphertext" TEXT,
  "tg_bot_token_hash" TEXT,
  PRIMARY KEY (id),
  CHECK (tier IN ('free', 'pro', 'enterprise'))
);

CREATE TABLE IF NOT EXISTS "signal_routes" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "route_name" TEXT NOT NULL,
  "source_chat_id" INTEGER NOT NULL,
  "destination_chat_id" INTEGER,
  "destination_type" TEXT NOT NULL,
  "custom_footer" TEXT DEFAULT '~~~ \n<b>Starpips Forex</b>',
  "transform_ai" INTEGER DEFAULT 1,
  "route_settings" TEXT DEFAULT '{}' CHECK (json_valid("route_settings")),
  "is_active" INTEGER DEFAULT 1,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK (destination_type IN ('telegram_vip', 'deriv_ws', 'ctrader_ws', 'mt5_webhook')),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES "workspaces" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "vip_members" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "telegram_id" INTEGER NOT NULL,
  "username" TEXT,
  "first_name" TEXT,
  "status" TEXT DEFAULT 'active',
  "trial_used" INTEGER DEFAULT 0,
  "subscription_tier" TEXT DEFAULT 'monthly',
  "expires_at" TEXT NOT NULL,
  "invite_link" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES "workspaces" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS "bank_deposits" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "telegram_id" INTEGER NOT NULL,
  "username" TEXT,
  "amount" TEXT NOT NULL,
  "plan_requested" TEXT NOT NULL,
  "receipt_photo_file_id" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending',
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES "workspaces" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "signal_logs" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "source_chat_id" INTEGER NOT NULL,
  "source_message_id" INTEGER NOT NULL,
  "raw_text" TEXT,
  "status" TEXT DEFAULT 'processed',
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE (source_chat_id, source_message_id),
  FOREIGN KEY (workspace_id) REFERENCES "workspaces" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_workspace_access" (
  "id" TEXT NOT NULL,
  "display_name" TEXT,
  "owner_email" TEXT,
  "zitadel_org_id" TEXT,
  "trading_access_enabled" INTEGER DEFAULT 0 NOT NULL,
  "trading_required_role" TEXT DEFAULT 'trading_access' NOT NULL,
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "source_connections" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_instance_id" TEXT NOT NULL,
  "display_name" TEXT,
  "secret_ciphertext" TEXT NOT NULL,
  "settings" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("settings")),
  "is_active" INTEGER DEFAULT 1 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_family" TEXT NOT NULL,
  "provider_type" TEXT NOT NULL,
  "is_default" INTEGER DEFAULT 0 NOT NULL,
  "priority" INTEGER DEFAULT 100 NOT NULL,
  "external_identity" TEXT,
  "config" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("config")),
  "health_status" TEXT DEFAULT 'UNCONFIGURED' NOT NULL,
  "last_heartbeat_at" TEXT,
  "last_event_at" TEXT,
  "last_connected_at" TEXT,
  "last_disconnected_at" TEXT,
  "restart_count" INTEGER DEFAULT 0 NOT NULL,
  "last_error_code" TEXT,
  "provider_secret_ciphertext" TEXT,
  "recovery_attempt_count" INTEGER DEFAULT 0 NOT NULL,
  "recovery_next_attempt_at" TEXT,
  "last_recovery_at" TEXT,
  "last_recovery_error_code" TEXT,
  "public_source_handle" TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, source_instance_id)
);

CREATE TABLE IF NOT EXISTS "trading_events" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "source_connection_id" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "event_version" TEXT DEFAULT '1.0' NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_external_id" TEXT,
  "occurred_at" TEXT,
  "received_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "raw_text" TEXT,
  "structured_payload" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("structured_payload")),
  "thread" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("thread")),
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "processing_status" TEXT DEFAULT 'RECEIVED' NOT NULL,
  "canonical_intent" TEXT CHECK (json_valid("canonical_intent")),
  "error_code" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "canonical_event_id" TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (source_connection_id) REFERENCES "source_connections" (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, source_connection_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS "destination_deliveries" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "trading_event_id" TEXT,
  "destination_type" TEXT NOT NULL,
  "destination_ref" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "status" TEXT DEFAULT 'PENDING' NOT NULL,
  "request_payload" TEXT CHECK (json_valid("request_payload")),
  "response_payload" TEXT CHECK (json_valid("response_payload")),
  "error_code" TEXT,
  "attempt_count" INTEGER DEFAULT 0 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "next_attempt_at" TEXT,
  "lease_expires_at" TEXT,
  "last_attempt_at" TEXT,
  "failure_class" TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (trading_event_id) REFERENCES "trading_events" (id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS "trading_workspace_memberships" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "zitadel_subject" TEXT NOT NULL,
  "trading_role" TEXT NOT NULL,
  "membership_enabled" INTEGER DEFAULT 1 NOT NULL,
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  CHECK (trading_role IN ('owner', 'admin', 'operator', 'viewer')),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, zitadel_subject)
);

CREATE TABLE IF NOT EXISTS "trading_workspace_hostnames" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" TEXT DEFAULT 'pending' NOT NULL,
  "verified_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (status <> 'active' OR verified_at IS NOT NULL),
  CHECK (hostname = lower(hostname)),
  CHECK (hostname = trim(hostname)),
  CHECK (substr(hostname, -1, 1) <> '.'),
  UNIQUE (hostname),
  PRIMARY KEY (id),
  CHECK (status IN ('pending', 'active', 'disabled')),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_access_codes" (
  "id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "product" TEXT DEFAULT 'trading' NOT NULL,
  "status" TEXT DEFAULT 'active' NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "workspace_display_name" TEXT,
  "owner_email" TEXT,
  "owner_name" TEXT,
  "role" TEXT DEFAULT 'owner' NOT NULL,
  "entitlements" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("entitlements")),
  "max_redemptions" INTEGER DEFAULT 1 NOT NULL,
  "redeemed_count" INTEGER DEFAULT 0 NOT NULL,
  "expires_at" TEXT,
  "last_redeemed_at" TEXT,
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE (code_hash),
  CHECK (max_redemptions > 0),
  PRIMARY KEY (id),
  CHECK (product = 'trading'),
  CHECK (redeemed_count >= 0),
  CHECK (role = 'owner'),
  CHECK (status IN ('active', 'disabled', 'revoked')),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_access_code_redemptions" (
  "id" TEXT NOT NULL,
  "access_code_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "zitadel_subject" TEXT NOT NULL,
  "owner_email" TEXT,
  "status" TEXT DEFAULT 'redeemed' NOT NULL,
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (access_code_id) REFERENCES "trading_access_codes" (id) ON DELETE CASCADE,
  PRIMARY KEY (id),
  CHECK (status IN ('redeemed', 'rejected')),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_destination_templates" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "template_name" TEXT NOT NULL,
  "formatting_mode" TEXT DEFAULT 'template' NOT NULL,
  "parse_mode" TEXT DEFAULT 'HTML' NOT NULL,
  "brand_name" TEXT,
  "header" TEXT,
  "footer" TEXT,
  "disclaimer" TEXT,
  "emoji_style" TEXT DEFAULT 'standard' NOT NULL,
  "cleanup_rules" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("cleanup_rules")),
  "layout" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("layout")),
  "is_default" INTEGER DEFAULT 0 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (formatting_mode IN ('none', 'clean', 'template', 'ai_then_fallback', 'clean_ai_fallback')),
  CHECK (parse_mode IN ('HTML', 'Markdown', 'MarkdownV2', 'plain')),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, template_name)
);

CREATE TABLE IF NOT EXISTS "trading_ctrader_oauth_states" (
  "id" TEXT NOT NULL,
  "state_token" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "requested_roles" TEXT DEFAULT '["source"]' NOT NULL CHECK (json_valid("requested_roles")),
  "expires_at" TEXT NOT NULL,
  "consumed_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (state_token),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_ingress_collectors" (
  "id" TEXT NOT NULL,
  "collector_name" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "is_active" INTEGER DEFAULT 1 NOT NULL,
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "last_seen_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS "source_feeds" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "source_connection_id" TEXT NOT NULL,
  "provider_feed_id" TEXT NOT NULL,
  "display_name" TEXT,
  "feed_type" TEXT DEFAULT 'telegram_chat' NOT NULL,
  "is_active" INTEGER DEFAULT 1 NOT NULL,
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, id, source_connection_id),
  UNIQUE (workspace_id, source_connection_id, provider_feed_id),
  FOREIGN KEY (workspace_id, source_connection_id) REFERENCES "source_connections" (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_destination_connections" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "provider_type" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "credential_ciphertext" TEXT NOT NULL,
  "is_active" INTEGER DEFAULT 1 NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  CHECK (provider_type = 'telegram_bot_api'),
  UNIQUE (workspace_id, display_name),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS "trading_event_revisions" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "trading_event_id" TEXT NOT NULL,
  "revision_key" TEXT NOT NULL,
  "event_version" TEXT DEFAULT '1.0' NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_external_id" TEXT,
  "external_event_id" TEXT NOT NULL,
  "occurred_at" TEXT,
  "received_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "raw_text" TEXT,
  "structured_payload" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("structured_payload")),
  "thread" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("thread")),
  "metadata" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("metadata")),
  "processing_status" TEXT DEFAULT 'RECEIVED' NOT NULL,
  "canonical_intent" TEXT CHECK (json_valid("canonical_intent")),
  "error_code" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (trading_event_id) REFERENCES "trading_events" (id) ON DELETE CASCADE,
  UNIQUE (trading_event_id, revision_key),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "orphan_signal_recovery_cursors" (
  "cursor_key" TEXT NOT NULL,
  "last_received_at" TEXT,
  "last_event_id" TEXT,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CHECK (last_received_at IS NULL AND last_event_id IS NULL OR last_received_at IS NOT NULL AND last_event_id IS NOT NULL),
  PRIMARY KEY (cursor_key)
);

CREATE TABLE IF NOT EXISTS "ai_providers" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "provider_name" TEXT NOT NULL,
  "base_url" TEXT,
  "model_name" TEXT NOT NULL,
  "priority_rank" INTEGER DEFAULT 1,
  "is_active" INTEGER DEFAULT 1,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "api_key_ciphertext" TEXT,
  "temperature" TEXT DEFAULT 0.1 NOT NULL,
  "max_output_tokens" INTEGER DEFAULT 1000 NOT NULL,
  "account_id" TEXT,
  "uses_binding" INTEGER DEFAULT 0 NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "provider_config" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("provider_config")),
  "last_health_status" TEXT,
  "last_health_checked_at" TEXT,
  "last_health_diagnostic" TEXT CHECK (json_valid("last_health_diagnostic")),
  CHECK (last_health_status IS NULL OR (last_health_status IN ('HEALTHY', 'FAILED'))),
  PRIMARY KEY (id),
  CHECK (provider_name IN ('openai', 'azure_openai', 'mkety_ai', 'gemini', 'google', 'vertex_ai', 'cloudflare_ai', 'workers_ai', 'aws_bedrock', 'deepseek', 'groq', 'custom')),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trade_accounts" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "account_label" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "api_token_encrypted" TEXT,
  "lot_sizing_type" TEXT DEFAULT 'fixed',
  "lot_value" TEXT DEFAULT 0.01,
  "is_active" INTEGER DEFAULT 1,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
  "execution_enabled" INTEGER DEFAULT 0 NOT NULL,
  "safety_policy" TEXT DEFAULT '{"enabled": true, "killSwitch": false}' NOT NULL CHECK (json_valid("safety_policy")),
  "fast_entry_policy" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("fast_entry_policy")),
  "entry_zone_policy" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("entry_zone_policy")),
  "credential_ciphertext" TEXT,
  "server_name" TEXT,
  "provider_mode" TEXT DEFAULT 'legacy' NOT NULL,
  "environment" TEXT,
  "roles" TEXT DEFAULT '["execution"]' NOT NULL CHECK (json_valid("roles")),
  "provider_config" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("provider_config")),
  "live_execution_enabled" INTEGER DEFAULT 0 NOT NULL,
  "lot_sizing_config" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("lot_sizing_config")),
  CHECK (lot_sizing_type IN ('fixed', 'adaptive_percent', 'symbol_equivalent', 'balance_percent', 'multiplier', 'risk_percent')),
  PRIMARY KEY (id),
  CHECK (platform IN ('deriv', 'ctrader', 'mt5')),
  CHECK (provider_mode IN ('legacy', 'ctrader_oauth', 'ctrader_cbot', 'mt5_bridge', 'mt5_cloud', 'mt5_connector')),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "position_groups" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "trade_account_id" TEXT,
  "source_event_id" TEXT,
  "correlation_key" TEXT,
  "canonical_symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "order_type" TEXT NOT NULL,
  "entry" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("entry")),
  "stop_loss" TEXT,
  "status" TEXT DEFAULT 'PLANNED' NOT NULL,
  "risk_plan" TEXT CHECK (json_valid("risk_plan")),
  "policy_snapshot" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("policy_snapshot")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_instance_id" TEXT,
  "source_event_ids" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("source_event_ids")),
  "thread_id" TEXT,
  "incomplete" INTEGER DEFAULT 0 NOT NULL,
  "position_mode" TEXT DEFAULT 'HEDGED' NOT NULL,
  "runtime_group_id" TEXT,
  PRIMARY KEY (id),
  CHECK (position_mode IN ('HEDGED', 'NETTED', 'SPREAD_BETTING')),
  CHECK (side IN ('BUY', 'SELL')),
  FOREIGN KEY (source_event_id) REFERENCES "trading_events" (id) ON DELETE SET NULL,
  FOREIGN KEY (trade_account_id) REFERENCES "trade_accounts" (id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "position_legs" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "position_group_id" TEXT NOT NULL,
  "target_index" INTEGER NOT NULL,
  "lots" TEXT NOT NULL,
  "stop_loss" TEXT,
  "take_profit" TEXT,
  "status" TEXT DEFAULT 'PLANNED' NOT NULL,
  "broker_position_id" TEXT,
  "broker_order_id" TEXT,
  "opened_at" TEXT,
  "closed_at" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "runtime_leg_id" TEXT,
  "broker_deal_id" TEXT,
  "fill_price" TEXT,
  "requested_lots" TEXT,
  "executed_lots" TEXT,
  "remaining_lots" TEXT,
  "volume_step_lots" TEXT,
  "minimum_lots" TEXT,
  "action_type" TEXT,
  "failure_code" TEXT,
  "parent_leg_id" TEXT,
  "lifecycle_role" TEXT,
  "lifecycle_tracking_enabled" INTEGER DEFAULT 0 NOT NULL,
  "originating_order_id" TEXT,
  "logical_target_index" INTEGER,
  "last_broker_observed_at" TEXT,
  "last_broker_source_version" TEXT,
  "last_broker_status" TEXT,
  "last_broker_snapshot_fingerprint" TEXT,
  "broker_deal_ids" TEXT DEFAULT '[]' NOT NULL CHECK (json_valid("broker_deal_ids")),
  CHECK (CAST(lots AS REAL) >= 0),
  PRIMARY KEY (id),
  FOREIGN KEY (position_group_id) REFERENCES "position_groups" (id) ON DELETE CASCADE,
  UNIQUE (position_group_id, target_index),
  CHECK (target_index > 0),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "trading_destinations" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "destination_type" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "destination_ref" TEXT,
  "template_id" TEXT,
  "credential_ciphertext" TEXT,
  "settings" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("settings")),
  "is_active" INTEGER DEFAULT 0 NOT NULL,
  "health_status" TEXT DEFAULT 'UNCONFIGURED' NOT NULL,
  "last_delivery_at" TEXT,
  "last_error_code" TEXT,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "credential_connection_id" TEXT,
  CHECK (destination_type IN ('telegram', 'broker_account', 'internal_webhook', 'audit_only')),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id, credential_connection_id) REFERENCES "trading_destination_connections" (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, template_id) REFERENCES "trading_destination_templates" (workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "source_destination_routes" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "source_connection_id" TEXT NOT NULL,
  "destination_id" TEXT NOT NULL,
  "route_name" TEXT,
  "priority" INTEGER DEFAULT 100 NOT NULL,
  "is_active" INTEGER DEFAULT 1 NOT NULL,
  "filters" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("filters")),
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "source_feed_id" TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id, destination_id) REFERENCES "trading_destinations" (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_feed_id, source_connection_id) REFERENCES "source_feeds" (workspace_id, id, source_connection_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_connection_id) REFERENCES "source_connections" (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "operation_journal" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "evidence_key" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "trading_event_id" TEXT,
  "source_connection_id" TEXT,
  "source_feed_id" TEXT,
  "route_id" TEXT,
  "destination_id" TEXT,
  "trade_account_id" TEXT,
  "ai_provider_id" TEXT,
  "position_group_id" TEXT,
  "connector_id" TEXT,
  "stage" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error_code" TEXT,
  "failure_class" TEXT,
  "retryable" INTEGER,
  "summary" TEXT,
  "details" TEXT DEFAULT '{}' NOT NULL CHECK (json_valid("details")),
  "observed_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "created_at" TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (ai_provider_id) REFERENCES "ai_providers" (id) ON DELETE SET NULL,
  FOREIGN KEY (destination_id) REFERENCES "trading_destinations" (id) ON DELETE SET NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (position_group_id) REFERENCES "position_groups" (id) ON DELETE SET NULL,
  FOREIGN KEY (route_id) REFERENCES "source_destination_routes" (id) ON DELETE SET NULL,
  FOREIGN KEY (source_connection_id) REFERENCES "source_connections" (id) ON DELETE SET NULL,
  FOREIGN KEY (source_feed_id) REFERENCES "source_feeds" (id) ON DELETE SET NULL,
  CHECK (stage IN ('INGRESS', 'AUTHORIZATION', 'INTERPRETATION', 'AI_PROVIDER', 'CORRELATION', 'ROUTE', 'DESTINATION', 'BROKER_PLANNING', 'BROKER_EXECUTION', 'MANAGEMENT', 'REPLAY', 'RECONCILIATION', 'CONNECTOR', 'PERSISTENCE')),
  CHECK (status IN ('SUCCEEDED', 'FAILED', 'SKIPPED', 'BLOCKED', 'RETRYABLE', 'UNCERTAIN', 'INFO')),
  FOREIGN KEY (trade_account_id) REFERENCES "trade_accounts" (id) ON DELETE SET NULL,
  FOREIGN KEY (trading_event_id) REFERENCES "trading_events" (id) ON DELETE SET NULL,
  UNIQUE (workspace_id, evidence_key),
  FOREIGN KEY (workspace_id) REFERENCES "trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_workspace_access_zitadel_org ON trading_workspace_access (zitadel_org_id) WHERE (zitadel_org_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_connections_external_identity ON source_connections (workspace_id, source_family, external_identity) WHERE (external_identity IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_connections_mtproto_recovery ON source_connections (provider_type, is_active, recovery_next_attempt_at, recovery_attempt_count) WHERE ((provider_type = 'cloudflare_container_mtproto') AND (is_active = true));

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_one_default_per_family ON source_connections (workspace_id, source_family) WHERE ((is_active = true) AND (is_default = true));

CREATE INDEX IF NOT EXISTS idx_source_connections_provider_type ON source_connections (provider_type) WHERE (is_active = true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_public_source_handle ON source_connections (public_source_handle) WHERE (public_source_handle IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_connections_workspace_active ON source_connections (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_source_connections_workspace_family_active ON source_connections (workspace_id, source_family, is_active, priority, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_workspace_id_unique ON source_connections (workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_trading_events_source_connection ON trading_events (source_connection_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_events_workspace_canonical_event ON trading_events (workspace_id, canonical_event_id) WHERE (canonical_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_trading_events_workspace_received ON trading_events (workspace_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_retry_due ON destination_deliveries (status, next_attempt_at, workspace_id) WHERE (status = 'RETRYABLE');

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_status ON destination_deliveries (workspace_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_trading_event ON destination_deliveries (trading_event_id) WHERE (trading_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_subject ON trading_workspace_memberships (zitadel_subject, membership_enabled);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_workspace ON trading_workspace_memberships (workspace_id, membership_enabled);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_hostnames_workspace_status ON trading_workspace_hostnames (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_trading_access_codes_status_expiry ON trading_access_codes (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_trading_access_codes_workspace ON trading_access_codes (workspace_id);

CREATE INDEX IF NOT EXISTS idx_trading_access_code_redemptions_code ON trading_access_code_redemptions (access_code_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_access_code_redemptions_workspace ON trading_access_code_redemptions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_destination_templates_workspace ON trading_destination_templates (workspace_id, is_default DESC, created_at);

CREATE INDEX IF NOT EXISTS trading_ctrader_oauth_states_workspace_expiry_idx ON trading_ctrader_oauth_states (workspace_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_ingress_collectors_active ON trading_ingress_collectors (is_active, id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_source_feeds_connection ON source_feeds (workspace_id, source_connection_id, is_active, provider_feed_id);

CREATE INDEX IF NOT EXISTS idx_trading_destination_connections_workspace ON trading_destination_connections (workspace_id, provider_type, is_active, created_at);

CREATE INDEX IF NOT EXISTS idx_trading_event_revisions_event_created ON trading_event_revisions (trading_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_event_revisions_workspace_created ON trading_event_revisions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_providers_workspace_priority_idx ON ai_providers (workspace_id, is_active, priority_rank);

CREATE INDEX IF NOT EXISTS idx_trade_accounts_workspace ON trade_accounts (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS trade_accounts_workspace_platform_mode_account_unique ON trade_accounts (workspace_id, platform, provider_mode, account_id);

CREATE INDEX IF NOT EXISTS idx_position_groups_correlation ON position_groups (workspace_id, correlation_key) WHERE (correlation_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_position_groups_source_event ON position_groups (source_event_id) WHERE (source_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_position_groups_source_state ON position_groups (workspace_id, source_instance_id, status, updated_at DESC) WHERE (status IN ('OPEN', 'PLANNED', 'PENDING'));

CREATE INDEX IF NOT EXISTS idx_position_groups_trade_account ON position_groups (trade_account_id) WHERE (trade_account_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_groups_workspace_runtime_group ON position_groups (workspace_id, runtime_group_id);

CREATE INDEX IF NOT EXISTS idx_position_groups_workspace_status ON position_groups (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_order ON position_legs (workspace_id, broker_order_id) WHERE (broker_order_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_position ON position_legs (workspace_id, broker_position_id) WHERE (broker_position_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_legs_group_runtime_leg ON position_legs (position_group_id, runtime_leg_id);

CREATE INDEX IF NOT EXISTS idx_position_legs_group_status ON position_legs (position_group_id, status);

CREATE INDEX IF NOT EXISTS idx_position_legs_pending_order_lifecycle ON position_legs (workspace_id, broker_order_id) WHERE ((status = 'PENDING') AND (lifecycle_tracking_enabled = true) AND (broker_order_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_position_legs_workspace ON position_legs (workspace_id);

CREATE INDEX IF NOT EXISTS idx_trading_destinations_credential_connection ON trading_destinations (workspace_id, credential_connection_id) WHERE (credential_connection_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_trading_destinations_workspace ON trading_destinations (workspace_id, destination_type, is_active, created_at);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_destination ON source_destination_routes (workspace_id, destination_id, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_feed ON source_destination_routes (workspace_id, source_feed_id, is_active, priority) WHERE (source_feed_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_source ON source_destination_routes (workspace_id, source_connection_id, is_active, priority);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_destination_routes_connection_default ON source_destination_routes (workspace_id, source_connection_id, destination_id) WHERE (source_feed_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_destination_routes_feed_destination ON source_destination_routes (workspace_id, source_feed_id, destination_id) WHERE (source_feed_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS operation_journal_correlation_time_idx ON operation_journal (workspace_id, correlation_id, observed_at);

CREATE INDEX IF NOT EXISTS operation_journal_event_time_idx ON operation_journal (trading_event_id, observed_at) WHERE (trading_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS operation_journal_stage_status_time_idx ON operation_journal (workspace_id, stage, status, observed_at DESC);

CREATE INDEX IF NOT EXISTS operation_journal_workspace_time_idx ON operation_journal (workspace_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_tg_bot_token_hash ON workspaces(tg_bot_token_hash) WHERE tg_bot_token_hash IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trading_destination_template_set_null_before_delete BEFORE DELETE ON trading_destination_templates
BEGIN
  UPDATE trading_destinations SET template_id = NULL
   WHERE workspace_id = OLD.workspace_id AND template_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trading_access_code_workspace_lock AFTER UPDATE OF status ON trading_access_codes
WHEN NEW.product = 'trading' AND NEW.status <> 'active' AND OLD.status = 'active'
BEGIN
  UPDATE trading_workspace_access
     SET trading_access_enabled = 0,
         metadata = json_set(COALESCE(metadata, '{}'), '$.accessLockedAt', CURRENT_TIMESTAMP, '$.accessLockReason', 'revoked'),
         updated_at = CURRENT_TIMESTAMP
   WHERE id = NEW.workspace_id
     AND json_extract(metadata, '$.accessCodeId') = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_enforce_connected_demo_execution_insert AFTER INSERT ON trade_accounts
WHEN lower(COALESCE(NEW.environment, '')) = 'demo'
  AND NULLIF(trim(COALESCE(NEW.account_id, '')), '') IS NOT NULL
  AND lower(COALESCE(NEW.account_id, '')) NOT LIKE 'pending:%'
  AND (lower(COALESCE(NEW.provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
       OR lower(COALESCE(json_extract(NEW.provider_config, '$.status'), '')) = 'connected')
BEGIN
  UPDATE trade_accounts
     SET is_active = 1,
         live_execution_enabled = 0,
         execution_enabled = CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 1 ELSE 0 END,
         safety_policy = json_set(COALESCE(NEW.safety_policy, '{}'), '$.killSwitch', json(CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 'false' ELSE 'true' END))
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_enforce_connected_demo_execution_update AFTER UPDATE ON trade_accounts
WHEN lower(COALESCE(NEW.environment, '')) = 'demo'
  AND NULLIF(trim(COALESCE(NEW.account_id, '')), '') IS NOT NULL
  AND lower(COALESCE(NEW.account_id, '')) NOT LIKE 'pending:%'
  AND (lower(COALESCE(NEW.provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
       OR lower(COALESCE(json_extract(NEW.provider_config, '$.status'), '')) = 'connected')
  AND (NEW.is_active IS NOT 1 OR NEW.live_execution_enabled IS NOT 0
       OR NEW.execution_enabled IS NOT CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 1 ELSE 0 END
       OR json_extract(NEW.safety_policy, '$.killSwitch') IS NOT CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 0 ELSE 1 END)
BEGIN
  UPDATE trade_accounts
     SET is_active = 1,
         live_execution_enabled = 0,
         execution_enabled = CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 1 ELSE 0 END,
         safety_policy = json_set(COALESCE(NEW.safety_policy, '{}'), '$.killSwitch', json(CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 'false' ELSE 'true' END))
   WHERE id = NEW.id;
END;
