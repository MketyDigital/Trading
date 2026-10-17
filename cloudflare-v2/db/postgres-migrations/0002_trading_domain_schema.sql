-- Dedicated Trading schema generated from the read-only 2026-10-17 production metadata snapshot.

-- Secrets are stored only as ciphertext; legacy plaintext credential columns are intentionally omitted.

CREATE TABLE IF NOT EXISTS trading_storage."workspaces" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "owner_email" text NOT NULL,
  "custom_domain" text,
  "tier" text DEFAULT 'free'::text,
  "tg_admin_chat_id" bigint,
  "tg_vip_chat_id" bigint,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "tg_bot_token_ciphertext" TEXT,
  "tg_bot_token_hash" TEXT,
  PRIMARY KEY (id),
  CHECK (tier = ANY (ARRAY['free'::text, 'pro'::text, 'enterprise'::text]))
);

CREATE TABLE IF NOT EXISTS trading_storage."signal_routes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "route_name" text NOT NULL,
  "source_chat_id" bigint NOT NULL,
  "destination_chat_id" bigint,
  "destination_type" text NOT NULL,
  "custom_footer" text DEFAULT '~~~ \n<b>Starpips Forex</b>'::text,
  "transform_ai" boolean DEFAULT true,
  "route_settings" jsonb DEFAULT '{}'::jsonb,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  CHECK (destination_type = ANY (ARRAY['telegram_vip'::text, 'deriv_ws'::text, 'ctrader_ws'::text, 'mt5_webhook'::text])),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."workspaces" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."vip_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "telegram_id" bigint NOT NULL,
  "username" text,
  "first_name" text,
  "status" text DEFAULT 'active'::text,
  "trial_used" boolean DEFAULT false,
  "subscription_tier" text DEFAULT 'monthly'::text,
  "expires_at" timestamp with time zone NOT NULL,
  "invite_link" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."workspaces" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, telegram_id)
);

CREATE TABLE IF NOT EXISTS trading_storage."bank_deposits" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "telegram_id" bigint NOT NULL,
  "username" text,
  "amount" numeric NOT NULL,
  "plan_requested" text NOT NULL,
  "receipt_photo_file_id" text NOT NULL,
  "status" text DEFAULT 'pending'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."workspaces" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."signal_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "source_chat_id" bigint NOT NULL,
  "source_message_id" bigint NOT NULL,
  "raw_text" text,
  "status" text DEFAULT 'processed'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (source_chat_id, source_message_id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."workspaces" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_workspace_access" (
  "id" uuid NOT NULL,
  "display_name" text,
  "owner_email" text,
  "zitadel_org_id" text,
  "trading_access_enabled" boolean DEFAULT false NOT NULL,
  "trading_required_role" text DEFAULT 'trading_access'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS trading_storage."source_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_instance_id" text NOT NULL,
  "display_name" text,
  "secret_ciphertext" text NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_family" text NOT NULL,
  "provider_type" text NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "external_identity" text,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "health_status" text DEFAULT 'UNCONFIGURED'::text NOT NULL,
  "last_heartbeat_at" timestamp with time zone,
  "last_event_at" timestamp with time zone,
  "last_connected_at" timestamp with time zone,
  "last_disconnected_at" timestamp with time zone,
  "restart_count" integer DEFAULT 0 NOT NULL,
  "last_error_code" text,
  "provider_secret_ciphertext" text,
  "recovery_attempt_count" integer DEFAULT 0 NOT NULL,
  "recovery_next_attempt_at" timestamp with time zone,
  "last_recovery_at" timestamp with time zone,
  "last_recovery_error_code" text,
  "public_source_handle" text,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, source_instance_id)
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_connection_id" uuid NOT NULL,
  "external_event_id" text NOT NULL,
  "event_version" text DEFAULT '1.0'::text NOT NULL,
  "source_type" text NOT NULL,
  "source_external_id" text,
  "occurred_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "raw_text" text,
  "structured_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "thread" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "processing_status" text DEFAULT 'RECEIVED'::text NOT NULL,
  "canonical_intent" jsonb,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "canonical_event_id" text,
  PRIMARY KEY (id),
  FOREIGN KEY (source_connection_id) REFERENCES trading_storage."source_connections" (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, source_connection_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS trading_storage."destination_deliveries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "trading_event_id" uuid,
  "destination_type" text NOT NULL,
  "destination_ref" text,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'PENDING'::text NOT NULL,
  "request_payload" jsonb,
  "response_payload" jsonb,
  "error_code" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "next_attempt_at" timestamp with time zone,
  "lease_expires_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "failure_class" text,
  PRIMARY KEY (id),
  FOREIGN KEY (trading_event_id) REFERENCES trading_storage."trading_events" (id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_workspace_memberships" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "zitadel_subject" text NOT NULL,
  "trading_role" text NOT NULL,
  "membership_enabled" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (trading_role = ANY (ARRAY['owner'::text, 'admin'::text, 'operator'::text, 'viewer'::text])),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, zitadel_subject)
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_workspace_hostnames" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "hostname" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CHECK (status <> 'active'::text OR verified_at IS NOT NULL),
  CHECK (hostname = lower(hostname)),
  CHECK (hostname = btrim(hostname)),
  CHECK (hostname !~ '\.$'::text),
  UNIQUE (hostname),
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text])),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_access_codes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "product" text DEFAULT 'trading'::text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "workspace_id" uuid NOT NULL,
  "workspace_display_name" text,
  "owner_email" text,
  "owner_name" text,
  "role" text DEFAULT 'owner'::text NOT NULL,
  "entitlements" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "max_redemptions" integer DEFAULT 1 NOT NULL,
  "redeemed_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone,
  "last_redeemed_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE (code_hash),
  CHECK (max_redemptions > 0),
  PRIMARY KEY (id),
  CHECK (product = 'trading'::text),
  CHECK (redeemed_count >= 0),
  CHECK (role = 'owner'::text),
  CHECK (status = ANY (ARRAY['active'::text, 'disabled'::text, 'revoked'::text])),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_access_code_redemptions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "access_code_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "zitadel_subject" text NOT NULL,
  "owner_email" text,
  "status" text DEFAULT 'redeemed'::text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  FOREIGN KEY (access_code_id) REFERENCES trading_storage."trading_access_codes" (id) ON DELETE CASCADE,
  PRIMARY KEY (id),
  CHECK (status = ANY (ARRAY['redeemed'::text, 'rejected'::text])),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_destination_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "template_name" text NOT NULL,
  "formatting_mode" text DEFAULT 'template'::text NOT NULL,
  "parse_mode" text DEFAULT 'HTML'::text NOT NULL,
  "brand_name" text,
  "header" text,
  "footer" text,
  "disclaimer" text,
  "emoji_style" text DEFAULT 'standard'::text NOT NULL,
  "cleanup_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CHECK (formatting_mode = ANY (ARRAY['none'::text, 'clean'::text, 'template'::text, 'ai_then_fallback'::text, 'clean_ai_fallback'::text])),
  CHECK (parse_mode = ANY (ARRAY['HTML'::text, 'Markdown'::text, 'MarkdownV2'::text, 'plain'::text])),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, template_name)
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_ctrader_oauth_states" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "state_token" text NOT NULL,
  "workspace_id" uuid NOT NULL,
  "subject" text NOT NULL,
  "requested_roles" jsonb DEFAULT '["source"]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (state_token),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_ingress_collectors" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "collector_name" text NOT NULL,
  "token_hash" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS trading_storage."source_feeds" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_connection_id" uuid NOT NULL,
  "provider_feed_id" text NOT NULL,
  "display_name" text,
  "feed_type" text DEFAULT 'telegram_chat'::text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, id, source_connection_id),
  UNIQUE (workspace_id, source_connection_id, provider_feed_id),
  FOREIGN KEY (workspace_id, source_connection_id) REFERENCES trading_storage."source_connections" (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_destination_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "provider_type" text NOT NULL,
  "display_name" text NOT NULL,
  "credential_ciphertext" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CHECK (provider_type = 'telegram_bot_api'::text),
  UNIQUE (workspace_id, display_name),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_event_revisions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "trading_event_id" uuid NOT NULL,
  "revision_key" text NOT NULL,
  "event_version" text DEFAULT '1.0'::text NOT NULL,
  "source_type" text NOT NULL,
  "source_external_id" text,
  "external_event_id" text NOT NULL,
  "occurred_at" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "raw_text" text,
  "structured_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "thread" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "processing_status" text DEFAULT 'RECEIVED'::text NOT NULL,
  "canonical_intent" jsonb,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (trading_event_id) REFERENCES trading_storage."trading_events" (id) ON DELETE CASCADE,
  UNIQUE (trading_event_id, revision_key),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."orphan_signal_recovery_cursors" (
  "cursor_key" text NOT NULL,
  "last_received_at" timestamp with time zone,
  "last_event_id" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CHECK (last_received_at IS NULL AND last_event_id IS NULL OR last_received_at IS NOT NULL AND last_event_id IS NOT NULL),
  PRIMARY KEY (cursor_key)
);

CREATE TABLE IF NOT EXISTS trading_storage."ai_providers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "provider_name" text NOT NULL,
  "base_url" text,
  "model_name" text NOT NULL,
  "priority_rank" integer DEFAULT 1,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "api_key_ciphertext" text,
  "temperature" numeric DEFAULT 0.1 NOT NULL,
  "max_output_tokens" integer DEFAULT 1000 NOT NULL,
  "account_id" text,
  "uses_binding" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_health_status" text,
  "last_health_checked_at" timestamp with time zone,
  "last_health_diagnostic" jsonb,
  CHECK (last_health_status IS NULL OR (last_health_status = ANY (ARRAY['HEALTHY'::text, 'FAILED'::text]))),
  PRIMARY KEY (id),
  CHECK (provider_name = ANY (ARRAY['openai'::text, 'azure_openai'::text, 'mkety_ai'::text, 'gemini'::text, 'google'::text, 'vertex_ai'::text, 'cloudflare_ai'::text, 'workers_ai'::text, 'aws_bedrock'::text, 'deepseek'::text, 'groq'::text, 'custom'::text])),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trade_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "account_label" text NOT NULL,
  "platform" text NOT NULL,
  "account_id" text NOT NULL,
  "api_token_encrypted" text,
  "lot_sizing_type" text DEFAULT 'fixed'::text,
  "lot_value" numeric DEFAULT 0.01,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "execution_enabled" boolean DEFAULT false NOT NULL,
  "safety_policy" jsonb DEFAULT '{"enabled": true, "killSwitch": false}'::jsonb NOT NULL,
  "fast_entry_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "entry_zone_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "credential_ciphertext" text,
  "server_name" text,
  "provider_mode" text DEFAULT 'legacy'::text NOT NULL,
  "environment" text,
  "roles" jsonb DEFAULT '["execution"]'::jsonb NOT NULL,
  "provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "live_execution_enabled" boolean DEFAULT false NOT NULL,
  "lot_sizing_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CHECK (environment IS NULL OR (environment = ANY (ARRAY['demo'::text, 'live'::text]))),
  CHECK (lot_sizing_type = ANY (ARRAY['fixed'::text, 'adaptive_percent'::text, 'symbol_equivalent'::text, 'balance_percent'::text, 'multiplier'::text, 'risk_percent'::text])),
  PRIMARY KEY (id),
  CHECK (platform = ANY (ARRAY['deriv'::text, 'ctrader'::text, 'mt5'::text])),
  CHECK (provider_mode = ANY (ARRAY['legacy'::text, 'ctrader_oauth'::text, 'ctrader_cbot'::text, 'mt5_bridge'::text, 'mt5_cloud'::text, 'mt5_connector'::text])),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS trading_storage."position_groups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "trade_account_id" uuid,
  "source_event_id" uuid,
  "correlation_key" text,
  "canonical_symbol" text NOT NULL,
  "side" text NOT NULL,
  "order_type" text NOT NULL,
  "entry" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "stop_loss" numeric,
  "status" text DEFAULT 'PLANNED'::text NOT NULL,
  "risk_plan" jsonb,
  "policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_instance_id" text,
  "source_event_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "thread_id" text,
  "incomplete" boolean DEFAULT false NOT NULL,
  "position_mode" text DEFAULT 'HEDGED'::text NOT NULL,
  "runtime_group_id" text,
  PRIMARY KEY (id),
  CHECK (position_mode = ANY (ARRAY['HEDGED'::text, 'NETTED'::text, 'SPREAD_BETTING'::text])),
  CHECK (side = ANY (ARRAY['BUY'::text, 'SELL'::text])),
  FOREIGN KEY (source_event_id) REFERENCES trading_storage."trading_events" (id) ON DELETE SET NULL,
  FOREIGN KEY (trade_account_id) REFERENCES trading_storage."trade_accounts" (id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."position_legs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "position_group_id" uuid NOT NULL,
  "target_index" integer NOT NULL,
  "lots" numeric NOT NULL,
  "stop_loss" numeric,
  "take_profit" numeric,
  "status" text DEFAULT 'PLANNED'::text NOT NULL,
  "broker_position_id" text,
  "broker_order_id" text,
  "opened_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "runtime_leg_id" text,
  "broker_deal_id" text,
  "fill_price" numeric,
  "requested_lots" numeric,
  "executed_lots" numeric,
  "remaining_lots" numeric,
  "volume_step_lots" numeric,
  "minimum_lots" numeric,
  "action_type" text,
  "failure_code" text,
  "parent_leg_id" text,
  "lifecycle_role" text,
  "lifecycle_tracking_enabled" boolean DEFAULT false NOT NULL,
  "originating_order_id" text,
  "logical_target_index" integer,
  "last_broker_observed_at" timestamp with time zone,
  "last_broker_source_version" text,
  "last_broker_status" text,
  "last_broker_snapshot_fingerprint" text,
  "broker_deal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CHECK (lots >= 0::numeric),
  PRIMARY KEY (id),
  FOREIGN KEY (position_group_id) REFERENCES trading_storage."position_groups" (id) ON DELETE CASCADE,
  UNIQUE (position_group_id, target_index),
  CHECK (target_index > 0),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."trading_destinations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "destination_type" text NOT NULL,
  "display_name" text NOT NULL,
  "destination_ref" text,
  "template_id" uuid,
  "credential_ciphertext" text,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "health_status" text DEFAULT 'UNCONFIGURED'::text NOT NULL,
  "last_delivery_at" timestamp with time zone,
  "last_error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "credential_connection_id" uuid,
  CHECK (destination_type = ANY (ARRAY['telegram'::text, 'broker_account'::text, 'internal_webhook'::text, 'audit_only'::text])),
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id, credential_connection_id) REFERENCES trading_storage."trading_destination_connections" (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, template_id) REFERENCES trading_storage."trading_destination_templates" (workspace_id, id) ON DELETE SET NULL (template_id)
);

CREATE TABLE IF NOT EXISTS trading_storage."source_destination_routes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_connection_id" uuid NOT NULL,
  "destination_id" uuid NOT NULL,
  "route_name" text,
  "priority" integer DEFAULT 100 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source_feed_id" uuid,
  PRIMARY KEY (id),
  FOREIGN KEY (workspace_id, destination_id) REFERENCES trading_storage."trading_destinations" (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_feed_id, source_connection_id) REFERENCES trading_storage."source_feeds" (workspace_id, id, source_connection_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_connection_id) REFERENCES trading_storage."source_connections" (workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trading_storage."operation_journal" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "evidence_key" text NOT NULL,
  "correlation_id" text NOT NULL,
  "trading_event_id" uuid,
  "source_connection_id" uuid,
  "source_feed_id" uuid,
  "route_id" uuid,
  "destination_id" uuid,
  "trade_account_id" uuid,
  "ai_provider_id" uuid,
  "position_group_id" uuid,
  "connector_id" text,
  "stage" text NOT NULL,
  "operation" text NOT NULL,
  "status" text NOT NULL,
  "error_code" text,
  "failure_class" text,
  "retryable" boolean,
  "summary" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "observed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  FOREIGN KEY (ai_provider_id) REFERENCES trading_storage."ai_providers" (id) ON DELETE SET NULL,
  FOREIGN KEY (destination_id) REFERENCES trading_storage."trading_destinations" (id) ON DELETE SET NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (position_group_id) REFERENCES trading_storage."position_groups" (id) ON DELETE SET NULL,
  FOREIGN KEY (route_id) REFERENCES trading_storage."source_destination_routes" (id) ON DELETE SET NULL,
  FOREIGN KEY (source_connection_id) REFERENCES trading_storage."source_connections" (id) ON DELETE SET NULL,
  FOREIGN KEY (source_feed_id) REFERENCES trading_storage."source_feeds" (id) ON DELETE SET NULL,
  CHECK (stage = ANY (ARRAY['INGRESS'::text, 'AUTHORIZATION'::text, 'INTERPRETATION'::text, 'AI_PROVIDER'::text, 'CORRELATION'::text, 'ROUTE'::text, 'DESTINATION'::text, 'BROKER_PLANNING'::text, 'BROKER_EXECUTION'::text, 'MANAGEMENT'::text, 'REPLAY'::text, 'RECONCILIATION'::text, 'CONNECTOR'::text, 'PERSISTENCE'::text])),
  CHECK (status = ANY (ARRAY['SUCCEEDED'::text, 'FAILED'::text, 'SKIPPED'::text, 'BLOCKED'::text, 'RETRYABLE'::text, 'UNCERTAIN'::text, 'INFO'::text])),
  FOREIGN KEY (trade_account_id) REFERENCES trading_storage."trade_accounts" (id) ON DELETE SET NULL,
  FOREIGN KEY (trading_event_id) REFERENCES trading_storage."trading_events" (id) ON DELETE SET NULL,
  UNIQUE (workspace_id, evidence_key),
  FOREIGN KEY (workspace_id) REFERENCES trading_storage."trading_workspace_access" (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_workspace_access_zitadel_org ON trading_storage.trading_workspace_access (zitadel_org_id) WHERE (zitadel_org_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_connections_external_identity ON trading_storage.source_connections (workspace_id, source_family, external_identity) WHERE (external_identity IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_connections_mtproto_recovery ON trading_storage.source_connections (provider_type, is_active, recovery_next_attempt_at, recovery_attempt_count) WHERE ((provider_type = 'cloudflare_container_mtproto'::text) AND (is_active = true));

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_one_default_per_family ON trading_storage.source_connections (workspace_id, source_family) WHERE ((is_active = true) AND (is_default = true));

CREATE INDEX IF NOT EXISTS idx_source_connections_provider_type ON trading_storage.source_connections (provider_type) WHERE (is_active = true);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_public_source_handle ON trading_storage.source_connections (public_source_handle) WHERE (public_source_handle IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_connections_workspace_active ON trading_storage.source_connections (workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_source_connections_workspace_family_active ON trading_storage.source_connections (workspace_id, source_family, is_active, priority, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_workspace_id_unique ON trading_storage.source_connections (workspace_id, id);

CREATE INDEX IF NOT EXISTS idx_trading_events_source_connection ON trading_storage.trading_events (source_connection_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trading_events_workspace_canonical_event ON trading_storage.trading_events (workspace_id, canonical_event_id) WHERE (canonical_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_trading_events_workspace_received ON trading_storage.trading_events (workspace_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_retry_due ON trading_storage.destination_deliveries (status, next_attempt_at, workspace_id) WHERE (status = 'RETRYABLE'::text);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_status ON trading_storage.destination_deliveries (workspace_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_destination_deliveries_trading_event ON trading_storage.destination_deliveries (trading_event_id) WHERE (trading_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_subject ON trading_storage.trading_workspace_memberships (zitadel_subject, membership_enabled);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_memberships_workspace ON trading_storage.trading_workspace_memberships (workspace_id, membership_enabled);

CREATE INDEX IF NOT EXISTS idx_trading_workspace_hostnames_workspace_status ON trading_storage.trading_workspace_hostnames (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_trading_access_codes_status_expiry ON trading_storage.trading_access_codes (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_trading_access_codes_workspace ON trading_storage.trading_access_codes (workspace_id);

CREATE INDEX IF NOT EXISTS idx_trading_access_code_redemptions_code ON trading_storage.trading_access_code_redemptions (access_code_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_access_code_redemptions_workspace ON trading_storage.trading_access_code_redemptions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_destination_templates_workspace ON trading_storage.trading_destination_templates (workspace_id, is_default DESC, created_at);

CREATE INDEX IF NOT EXISTS trading_ctrader_oauth_states_workspace_expiry_idx ON trading_storage.trading_ctrader_oauth_states (workspace_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_ingress_collectors_active ON trading_storage.trading_ingress_collectors (is_active, id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS idx_source_feeds_connection ON trading_storage.source_feeds (workspace_id, source_connection_id, is_active, provider_feed_id);

CREATE INDEX IF NOT EXISTS idx_trading_destination_connections_workspace ON trading_storage.trading_destination_connections (workspace_id, provider_type, is_active, created_at);

CREATE INDEX IF NOT EXISTS idx_trading_event_revisions_event_created ON trading_storage.trading_event_revisions (trading_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trading_event_revisions_workspace_created ON trading_storage.trading_event_revisions (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_providers_workspace_priority_idx ON trading_storage.ai_providers (workspace_id, is_active, priority_rank);

CREATE INDEX IF NOT EXISTS idx_trade_accounts_workspace ON trading_storage.trade_accounts (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS trade_accounts_workspace_platform_mode_account_unique ON trading_storage.trade_accounts (workspace_id, platform, provider_mode, account_id);

CREATE INDEX IF NOT EXISTS idx_position_groups_correlation ON trading_storage.position_groups (workspace_id, correlation_key) WHERE (correlation_key IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_position_groups_source_event ON trading_storage.position_groups (source_event_id) WHERE (source_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_position_groups_source_state ON trading_storage.position_groups (workspace_id, source_instance_id, status, updated_at DESC) WHERE (status = ANY (ARRAY['OPEN'::text, 'PLANNED'::text, 'PENDING'::text]));

CREATE INDEX IF NOT EXISTS idx_position_groups_trade_account ON trading_storage.position_groups (trade_account_id) WHERE (trade_account_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_groups_workspace_runtime_group ON trading_storage.position_groups (workspace_id, runtime_group_id);

CREATE INDEX IF NOT EXISTS idx_position_groups_workspace_status ON trading_storage.position_groups (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_order ON trading_storage.position_legs (workspace_id, broker_order_id) WHERE (broker_order_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_position_legs_broker_position ON trading_storage.position_legs (workspace_id, broker_position_id) WHERE (broker_position_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_position_legs_group_runtime_leg ON trading_storage.position_legs (position_group_id, runtime_leg_id);

CREATE INDEX IF NOT EXISTS idx_position_legs_group_status ON trading_storage.position_legs (position_group_id, status);

CREATE INDEX IF NOT EXISTS idx_position_legs_pending_order_lifecycle ON trading_storage.position_legs (workspace_id, broker_order_id) WHERE ((status = 'PENDING'::text) AND (lifecycle_tracking_enabled = true) AND (broker_order_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_position_legs_workspace ON trading_storage.position_legs (workspace_id);

CREATE INDEX IF NOT EXISTS idx_trading_destinations_credential_connection ON trading_storage.trading_destinations (workspace_id, credential_connection_id) WHERE (credential_connection_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_trading_destinations_workspace ON trading_storage.trading_destinations (workspace_id, destination_type, is_active, created_at);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_destination ON trading_storage.source_destination_routes (workspace_id, destination_id, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_feed ON trading_storage.source_destination_routes (workspace_id, source_feed_id, is_active, priority) WHERE (source_feed_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_source_destination_routes_source ON trading_storage.source_destination_routes (workspace_id, source_connection_id, is_active, priority);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_destination_routes_connection_default ON trading_storage.source_destination_routes (workspace_id, source_connection_id, destination_id) WHERE (source_feed_id IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_destination_routes_feed_destination ON trading_storage.source_destination_routes (workspace_id, source_feed_id, destination_id) WHERE (source_feed_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS operation_journal_correlation_time_idx ON trading_storage.operation_journal (workspace_id, correlation_id, observed_at);

CREATE INDEX IF NOT EXISTS operation_journal_event_time_idx ON trading_storage.operation_journal (trading_event_id, observed_at) WHERE (trading_event_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS operation_journal_stage_status_time_idx ON trading_storage.operation_journal (workspace_id, stage, status, observed_at DESC);

CREATE INDEX IF NOT EXISTS operation_journal_workspace_time_idx ON trading_storage.operation_journal (workspace_id, observed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_tg_bot_token_hash ON trading_storage."workspaces"("tg_bot_token_hash") WHERE "tg_bot_token_hash" IS NOT NULL;

CREATE OR REPLACE FUNCTION trading_storage.enforce_connected_demo_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  has_execution_role boolean;
  connected_demo boolean;
BEGIN
  has_execution_role := COALESCE(NEW.roles, '[]'::jsonb) ? 'execution';
  connected_demo :=
    lower(COALESCE(NEW.environment, '')) = 'demo'
    AND NULLIF(btrim(COALESCE(NEW.account_id, '')), '') IS NOT NULL
    AND lower(COALESCE(NEW.account_id, '')) NOT LIKE 'pending:%'
    AND (
      lower(COALESCE(NEW.provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
      OR lower(COALESCE(NEW.provider_config->>'status', '')) = 'connected'
    );

  IF connected_demo THEN
    NEW.is_active := true;
    NEW.live_execution_enabled := false;
    IF has_execution_role THEN
      NEW.execution_enabled := true;
      NEW.safety_policy := jsonb_set(COALESCE(NEW.safety_policy, '{}'::jsonb), '{killSwitch}', 'false'::jsonb, true);
    ELSE
      NEW.execution_enabled := false;
      NEW.safety_policy := jsonb_set(COALESCE(NEW.safety_policy, '{}'::jsonb), '{killSwitch}', 'true'::jsonb, true);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$


CREATE TRIGGER trg_enforce_connected_demo_execution BEFORE INSERT OR UPDATE ON trading_storage.trade_accounts FOR EACH ROW EXECUTE FUNCTION trading_storage.enforce_connected_demo_execution();

CREATE OR REPLACE FUNCTION trading_storage.sync_trading_workspace_access_code_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_now TIMESTAMPTZ := now();
BEGIN
    IF NEW.product = 'trading'
       AND NEW.status IS DISTINCT FROM 'active'
       AND OLD.status = 'active' THEN
        UPDATE trading_storage.trading_workspace_access
           SET trading_access_enabled = false,
               metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                   'accessLockedAt', v_now,
                   'accessLockReason', 'revoked'
               ),
               updated_at = v_now
         WHERE id = NEW.workspace_id
           AND metadata ->> 'accessCodeId' = NEW.id::text;
    END IF;
    RETURN NEW;
END;
$function$


CREATE TRIGGER trading_access_code_workspace_lock AFTER UPDATE OF status ON trading_storage.trading_access_codes FOR EACH ROW EXECUTE FUNCTION trading_storage.sync_trading_workspace_access_code_status();

REVOKE ALL ON FUNCTION trading_storage.sync_trading_workspace_access_code_status() FROM PUBLIC;

CREATE OR REPLACE FUNCTION trading_storage.rotate_trading_access_code(p_workspace_id uuid, p_owner_email text, p_workspace_display_name text, p_owner_name text, p_code_hash text, p_entitlements jsonb, p_max_redemptions integer, p_expires_at timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS trading_storage.trading_access_codes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_workspace trading_storage.trading_workspace_access%ROWTYPE;
    v_created trading_storage.trading_access_codes%ROWTYPE;
    v_owner_email TEXT := lower(trim(coalesce(p_owner_email, '')));
    v_now TIMESTAMPTZ := now();
    v_workspace_metadata JSONB;
    v_existing_entitlements JSONB;
    v_requested_entitlements JSONB := coalesce(p_entitlements, '{}'::jsonb);
    v_effective_entitlements JSONB;
    v_source_types JSONB;
    v_destinations JSONB;
BEGIN
    SELECT *
      INTO v_workspace
      FROM trading_storage.trading_workspace_access
     WHERE id = p_workspace_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_CODE_REISSUE_WORKSPACE_NOT_FOUND';
    END IF;

    IF coalesce(trim(v_workspace.owner_email), '') <> ''
       AND lower(trim(v_workspace.owner_email)) <> v_owner_email THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ACCESS_CODE_REISSUE_OWNER_MISMATCH';
    END IF;

    IF v_owner_email = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'OWNER_EMAIL_REQUIRED';
    END IF;

    v_existing_entitlements := coalesce(v_workspace.metadata -> 'entitlements', '{}'::jsonb);

    SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      INTO v_source_types
      FROM (
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_existing_entitlements -> 'sourceTypes', '[]'::jsonb)) AS existing(value)
        UNION
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_requested_entitlements -> 'sourceTypes', '[]'::jsonb)) AS requested(value)
      ) merged_sources;

    SELECT coalesce(jsonb_agg(value ORDER BY value), '[]'::jsonb)
      INTO v_destinations
      FROM (
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_existing_entitlements -> 'destinations', '[]'::jsonb)) AS existing(value)
        UNION
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(coalesce(v_requested_entitlements -> 'destinations', '[]'::jsonb)) AS requested(value)
      ) merged_destinations;

    v_effective_entitlements := v_existing_entitlements || v_requested_entitlements || jsonb_build_object(
        'customSubdomain', coalesce((v_existing_entitlements ->> 'customSubdomain')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'customSubdomain')::boolean, false),
        'customHostname', coalesce((v_existing_entitlements ->> 'customHostname')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'customHostname')::boolean, false),
        'tradingExecutionDestination', coalesce((v_existing_entitlements ->> 'tradingExecutionDestination')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'tradingExecutionDestination')::boolean, false),
        'telegramDestination', coalesce((v_existing_entitlements ->> 'telegramDestination')::boolean, false)
            OR coalesce((v_requested_entitlements ->> 'telegramDestination')::boolean, false),
        'sourceTypes', v_source_types,
        'destinations', v_destinations,
        'brokerModes', jsonb_build_array('demo'),
        'liveExecution', false,
        'maxTeamMembers', greatest(
            coalesce((v_existing_entitlements ->> 'maxTeamMembers')::integer, 1),
            coalesce((v_requested_entitlements ->> 'maxTeamMembers')::integer, 1)
        )
    );

    INSERT INTO trading_storage.trading_access_codes (
        code_hash,
        product,
        status,
        workspace_id,
        workspace_display_name,
        owner_email,
        owner_name,
        role,
        entitlements,
        max_redemptions,
        redeemed_count,
        expires_at,
        metadata,
        created_at,
        updated_at
    ) VALUES (
        p_code_hash,
        'trading',
        'active',
        p_workspace_id,
        coalesce(nullif(v_workspace.display_name, ''), p_workspace_display_name),
        coalesce(nullif(v_workspace.owner_email, ''), v_owner_email),
        p_owner_name,
        'owner',
        v_effective_entitlements,
        greatest(coalesce(p_max_redemptions, 1), 1),
        0,
        p_expires_at,
        coalesce(p_metadata, '{}'::jsonb),
        v_now,
        v_now
    )
    RETURNING * INTO v_created;

    UPDATE trading_storage.trading_access_codes
       SET status = 'revoked', updated_at = v_now
     WHERE workspace_id = p_workspace_id
       AND status = 'active'
       AND id <> v_created.id;

    v_workspace_metadata := (coalesce(v_workspace.metadata, '{}'::jsonb) - 'accessLockedAt' - 'accessLockReason')
        || jsonb_build_object(
            'accessCodeProvisioned', true,
            'accessCodeId', v_created.id,
            'entitlements', v_effective_entitlements
        );

    UPDATE trading_storage.trading_workspace_access
       SET display_name = coalesce(nullif(v_workspace.display_name, ''), p_workspace_display_name),
           owner_email = coalesce(nullif(v_workspace.owner_email, ''), v_owner_email),
           trading_access_enabled = true,
           metadata = v_workspace_metadata,
           updated_at = v_now
     WHERE id = p_workspace_id;

    RETURN v_created;
END;
$function$


REVOKE ALL ON FUNCTION trading_storage.rotate_trading_access_code(uuid, text, text, text, text, jsonb, integer, timestamptz, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION trading_storage.trading_set_default_source(p_workspace_id uuid, p_source_family text, p_source_id uuid)
 RETURNS trading_storage.source_connections
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    target trading_storage.source_connections;
BEGIN
    SELECT * INTO target
    FROM trading_storage.source_connections
    WHERE id = p_source_id
      AND workspace_id = p_workspace_id
      AND source_family = p_source_family
      AND is_active = TRUE
    FOR UPDATE;

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'source not enabled for workspace/family';
    END IF;

    UPDATE trading_storage.source_connections
    SET is_default = FALSE,
        updated_at = NOW()
    WHERE workspace_id = p_workspace_id
      AND source_family = p_source_family
      AND is_default = TRUE
      AND id <> p_source_id;

    UPDATE trading_storage.source_connections
    SET is_default = TRUE,
        updated_at = NOW()
    WHERE id = p_source_id
    RETURNING * INTO target;

    RETURN target;
END;
$function$


-- Grant EXECUTE on these functions only to the dedicated Trading Worker role when that role is provisioned.

-- Supabase catalog confirms both RPCs are executable by service_role only; anon, authenticated, and PUBLIC are denied.
