import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(here, '../../.github/workflows/gate7-demo-destinations.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

test('Gate 7 demo lifecycle uses the Trading PostgreSQL runtime without Supabase secrets', () => {
  const pgBindings = workflow.match(/TRADING_PG_STAGING_DATABASE_URL: \$\{\{ secrets\.TRADING_PG_STAGING_DATABASE_URL \}\}/g) ?? [];
  const masterKeys = workflow.match(/TRADING_MASTER_KEY: \$\{\{ secrets\.TRADING_MASTER_KEY \}\}/g) ?? [];
  assert.equal(pgBindings.length, 2);
  assert.equal(masterKeys.length, 2);
  assert.match(workflow, /TRADING_STORAGE_AUTHORITY: postgres/);
  assert.doesNotMatch(workflow, /SUPABASE_/);
});

test('Gate 7 keeps broker execution globally disabled during demo lifecycle acceptance', () => {
  const matches = workflow.match(/BROKER_EXECUTION_ENABLED: 'false'/g) ?? [];
  assert.equal(matches.length, 2);
});
