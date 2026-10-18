import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test('Worker runtime and Cloudflare deploy paths have no Supabase SDK or credential dependency', async () => {
  const sourceFiles = await filesUnder(join(root, 'src'));
  const [packageJson, packageLock, productionDeploy, stagingInspection] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8'),
    readFile(join(root, 'package-lock.json'), 'utf8'),
    readFile(join(repositoryRoot, '.github/workflows/production-cloudflare-deploy.yml'), 'utf8'),
    readFile(join(repositoryRoot, '.github/workflows/cloudflare-staging-gate.yml'), 'utf8'),
  ]);
  const runtimeSource = (await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))).join('\n');
  const deployConfig = `${productionDeploy}\n${stagingInspection}`;

  assert.equal(JSON.parse(packageJson).dependencies?.['@supabase/supabase-js'], undefined);
  assert.doesNotMatch(packageLock, /"node_modules\/@supabase\/supabase-js"/);
  assert.doesNotMatch(runtimeSource, /@supabase\/supabase-js|createClient\s*\(|(?:env|process\.env)\.?SUPABASE_[A-Z0-9_]*/i);
  assert.doesNotMatch(deployConfig, /SUPABASE_[A-Z0-9_]*/i);
  assert.doesNotMatch(stagingInspection, /wrangler deploy --config/);
});
