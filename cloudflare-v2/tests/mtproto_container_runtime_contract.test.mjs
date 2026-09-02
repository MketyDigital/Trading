import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrangler = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const entry = await readFile(new URL('../src/v1_entry.js', import.meta.url), 'utf8');


test('Cloudflare MTProto runtime is an explicitly bound stateful Container', () => {
  assert.match(wrangler, /\[\[containers\]\][\s\S]*class_name\s*=\s*"MtprotoContainerRuntime"/);
  assert.match(wrangler, /image\s*=\s*"\.\/containers\/mtproto-listener\/Dockerfile"/);
  assert.match(wrangler, /instance_type\s*=\s*"lite"/);
  assert.match(wrangler, /name\s*=\s*"MTPROTO_CONTAINER_NAMESPACE"[\s\S]*class_name\s*=\s*"MtprotoContainerRuntime"/);
  assert.match(wrangler, /tag\s*=\s*"v3"[\s\S]*new_sqlite_classes\s*=\s*\["MtprotoContainerRuntime"\]/);
});


test('Worker entry exports the Container Durable Object and installs official runtime dependency', () => {
  assert.ok(pkg.dependencies?.['@cloudflare/containers']);
  assert.match(entry, /export\s*\{\s*MtprotoContainerRuntime\s*\}\s*from\s*['"]\.\/sources\/mtproto\/container_runtime\.js['"]/);
});


test('Container image contract exists and starts only the isolated MTProto service', async () => {
  const dockerfile = await readFile(new URL('../containers/mtproto-listener/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /FROM\s+python:3\.12-slim/i);
  assert.match(dockerfile, /CMD\s+\["python",\s*"app\.py"\]/);
  assert.doesNotMatch(dockerfile, /api[_-]?hash|session[_-]?string|transport[_-]?token/i);
});
