import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../db/migrations/0001_enterprise_trading_foundation.sql', import.meta.url), 'utf8');

test('migration keeps shared Mkety workspaces untouched and creates Trading-owned access binding', () => {
  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.trading_workspace_access/i);
  assert.match(sql, /zitadel_org_id/i);
  assert.match(sql, /trading_access_enabled/i);
  assert.match(sql, /trading_required_role/i);
});

test('migration creates universal source registry and durable event idempotency under Trading workspace authority', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.source_connections/i);
  assert.match(sql, /REFERENCES public\.trading_workspace_access\(id\)/i);
  assert.match(sql, /secret_ciphertext/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.trading_events/i);
  assert.match(sql, /UNIQUE\s*\(workspace_id,\s*source_connection_id,\s*external_event_id\)/i);
});

test('migration persists position groups and child legs for correlation and management', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.position_groups/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.position_legs/i);
  assert.match(sql, /broker_position_id/i);
  assert.match(sql, /broker_order_id/i);
});

test('migration creates idempotent destination delivery audit records', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.destination_deliveries/i);
  assert.match(sql, /idempotency_key/i);
  assert.match(sql, /UNIQUE\s*\(workspace_id,\s*idempotency_key\)/i);
});
