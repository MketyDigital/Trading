import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/production-cloudflare-deploy.yml', import.meta.url);

test('production deploy derives a stable separated access-code session secret when dedicated secret is absent', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');
  assert.match(workflow, /mkety-trading-access-code-session-v1/);
  assert.match(workflow, /createHmac\(['"]sha256['"]/);
  assert.doesNotMatch(workflow, /openssl rand -base64 48/);
});
