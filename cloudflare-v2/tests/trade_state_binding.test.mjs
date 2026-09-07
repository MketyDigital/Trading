import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as entry from '../src/v1_entry.js';

const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('v1 entry exports TradeStateNode for Cloudflare binding', () => {
  assert.equal(typeof entry.TradeStateNode, 'function');
});

test('wrangler binds TradeStateNode with additive sqlite migration v2', () => {
  assert.match(wrangler, /name\s*=\s*"TRADE_STATE_NAMESPACE"[\s\S]*class_name\s*=\s*"TradeStateNode"/i);
  assert.match(wrangler, /tag\s*=\s*"v2"[\s\S]*new_sqlite_classes\s*=\s*\[\s*"TradeStateNode"\s*\]/i);
});
