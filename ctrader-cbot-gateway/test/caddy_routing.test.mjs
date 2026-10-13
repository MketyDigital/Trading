import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const configs = [
  '../deploy/Caddyfile',
  '../deploy/coolify/Caddyfile',
  '../deploy/portable/Caddyfile',
];

for (const relativePath of configs) {
  test(`${relativePath} proxies lifecycle status requests to the HTTP control APIs`, async () => {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');

    assert.match(
      source,
      /@mt5control path[^\n]*\/v1\/mt5-order-status\/\*/,
      'MT5 order status must reach the MT5 HTTP control API',
    );
    assert.match(
      source,
      /@control path[^\n]*\/v1\/order-lifecycle\/\*/,
      'cTrader order lifecycle must reach the cTrader HTTP control API',
    );
  });
}
