import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, '../../.github/workflows/gate7-demo-destinations.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Gate 7 demo lifecycle accepts every supported Supabase service-role secret alias', () => {
  assert.match(workflow, /SUPABASE_SERVICE_ROLE: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE \}\}/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
  assert.match(workflow, /SUPABASE_SERVICE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/);

  const aliasResolvers = workflow.match(/service_role="\$\{SUPABASE_SERVICE_ROLE:-\$\{SUPABASE_SERVICE_ROLE_KEY:-\$\{SUPABASE_SERVICE_KEY:-\}\}\}"/g) ?? [];
  assert.equal(aliasResolvers.length, 2);

  const normalizedExports = workflow.match(/echo "SUPABASE_SERVICE_ROLE=\$service_role" >> "\$GITHUB_ENV"/g) ?? [];
  assert.equal(normalizedExports.length, 2);
});

test('Gate 7 keeps broker execution globally disabled during demo lifecycle acceptance', () => {
  const matches = workflow.match(/BROKER_EXECUTION_ENABLED: 'false'/g) ?? [];
  assert.equal(matches.length, 2);
});
