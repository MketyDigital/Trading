import test from 'node:test';
import assert from 'node:assert/strict';

import { handleTelegramBotAdminRequest } from '../src/http/telegram_bot_admin.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';

function fakeSupabase() {
  const state = { sourceInsert: null, feedUpsert: null };
  return {
    state,
    from(table) {
      if (table === 'source_connections') {
        return {
          insert(row) {
            state.sourceInsert = row;
            return {
              select() { return this; },
              async maybeSingle() {
                return {
                  data: {
                    id: sourceId,
                    ...row,
                  },
                  error: null,
                };
              },
            };
          },
        };
      }
      if (table === 'source_feeds') {
        return {
          upsert(rows, options) {
            state.feedUpsert = { rows, options };
            return {
              async select() {
                return {
                  data: rows.map((row, index) => ({ id: `feed-${index + 1}`, ...row, display_name: null, metadata: {} })),
                  error: null,
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('dedicated Telegram Bot source creation materializes every allowed chat as an active child source feed', async () => {
  const supabase = fakeSupabase();
  const request = new Request('https://trade.mkety.com/api/v1/admin/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerType: 'telegram_bot_api',
      sourceFamily: 'telegram',
      sourceType: 'telegram_bot',
      sourceInstanceId: 'signals-bot',
      displayName: 'Signals Bot',
      config: { chat_ids: ['-100111', '-100222', '-100111'] },
      credentials: { botToken: '123456:ABCDEF' },
    }),
  });

  const response = await handleTelegramBotAdminRequest(request, {
    TRADING_MASTER_KEY: 'test-master-key',
  }, {
    supabaseFactory: async () => supabase,
    authorizeFn: async () => ({
      ok: true,
      workspace: { id: workspaceId, metadata: { accessCodeProvisioned: true, entitlements: { sourceTypes: ['telegram'] } } },
      membership: { role: 'owner' },
      entitlements: { sourceTypes: ['telegram'] },
    }),
    encryptCredentials: async () => 'encrypted-bot-token',
    encryptIngressSecret: async () => 'encrypted-webhook-secret',
    generateHandle: () => 'public-handle',
    generateWebhookSecret: () => 'webhook-secret',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(supabase.state.sourceInsert.config.chat_ids, ['-100111', '-100222']);
  assert.ok(supabase.state.feedUpsert, 'source feed rows must be persisted by the dedicated Telegram Bot create path');
  assert.equal(supabase.state.feedUpsert.options.onConflict, 'workspace_id,source_connection_id,provider_feed_id');
  assert.deepEqual(
    supabase.state.feedUpsert.rows.map((row) => row.provider_feed_id),
    ['-100111', '-100222'],
  );
  assert.ok(supabase.state.feedUpsert.rows.every((row) => row.workspace_id === workspaceId));
  assert.ok(supabase.state.feedUpsert.rows.every((row) => row.source_connection_id === sourceId));
  assert.ok(supabase.state.feedUpsert.rows.every((row) => row.is_active === true));
});
