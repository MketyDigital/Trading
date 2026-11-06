import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTradingAccountFollowerReplicationEvent } from '../src/persistence/trading_account_follower_replication.js';

test('Postgres follower replication update casts risk percentage and amount as numeric parameters', async () => {
  const statements = [];
  const postgresDatabase = {
    async transaction(callback) {
      return callback(async (sql, params = []) => {
        statements.push({ sql, params });
        if (sql.includes('trading_storage.authority_control')) {
          return { rows: [{ active_authority: 'd1', authority_epoch: 7 }] };
        }
        return { rows: [] };
      });
    },
  };

  await applyTradingAccountFollowerReplicationEvent({
    authorityEpoch: 7,
    direction: 'd1_to_postgres',
    entityType: 'trading_account_follower',
    entityId: 'link-1',
    operation: 'upsert',
    payload: {
      _mutation: 'update',
      workspace_id: 'ws-a',
      follower_account_id: 'acct-a',
      risk_mode: 'equity_percent',
      risk_percent: 1.25,
      risk_amount: 25,
      risk_basis: 'equity',
    },
  }, {
    targetAuthority: { kind: 'postgres', authorityEpoch: 7 },
    postgresDatabase,
  });

  const update = statements.find((item) => item.sql.startsWith('UPDATE trading_storage.trading_account_followers'));
  assert.ok(update);
  assert.match(update.sql, /risk_percent=\$\d+::numeric/);
  assert.match(update.sql, /risk_amount=\$\d+::numeric/);
  assert.match(update.sql, /WHERE id=\$\d+ AND workspace_id=\$\d+/);
});
