import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('production Wrangler config binds only the reviewed existing Trading D1 and mkety Hyperdrive', () => {
  assert.match(config, /^TRADING_STORAGE_RUNTIME_ENABLED = "true"$/m);
  assert.match(config, /^TRADING_STORAGE_AUTHORITY = "d1"$/m);
  assert.match(config, /^TRADING_STORAGE_AUTHORITY_EPOCH = "1"$/m);
  assert.match(config, /^LIVE_BROKER_EXECUTION_ENABLED = "false"$/m);
  assert.match(config, /\[\[d1_databases\]\][\s\S]*?binding = "DB"[\s\S]*?database_name = "trading-staging"[\s\S]*?database_id = "4f00d59a-3d90-4146-832d-36230d5648bb"/);
  assert.match(config, /\[\[hyperdrive\]\][\s\S]*?binding = "TRADING_PG"[\s\S]*?id = "87de630bb6674c65bae35fcbb0d30532"/);
});
