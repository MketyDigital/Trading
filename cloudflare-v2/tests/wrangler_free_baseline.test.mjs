import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const paid = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const free = await readFile(new URL('../wrangler.free.toml', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../src/sources/mtproto/container_bootstrap.js', import.meta.url), 'utf8');

test('default paid config retains optional Container runtime', () => {
  assert.match(paid, /\[\[containers\]\][\s\S]*class_name\s*=\s*"MtprotoContainerRuntime"/);
  assert.match(paid, /name\s*=\s*"MTPROTO_CONTAINER_NAMESPACE"/);
});

test('free baseline config has no Container binding but keeps Free-compatible core primitives', () => {
  assert.doesNotMatch(free, /\[\[containers\]\]/);
  assert.doesNotMatch(free, /MTPROTO_CONTAINER_NAMESPACE/);
  assert.match(free, /MTPROTO_LISTENER_NAMESPACE/);
  assert.match(free, /TRADE_STATE_NAMESPACE/);
  assert.match(free, /\[\[queues\.producers\]\]/);
  assert.match(free, /\[\[queues\.consumers\]\]/);
  assert.match(free, /\[triggers\]/);
});

test('Container bootstrap can resolve only explicitly selected container provider sources', () => {
  assert.match(bootstrap, /\.eq\('provider_type',\s*'cloudflare_container_mtproto'\)/);
  assert.match(bootstrap, /\.eq\('is_active',\s*true\)/);
});
