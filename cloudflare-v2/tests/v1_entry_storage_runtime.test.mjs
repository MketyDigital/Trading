import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const entrypoint = fs.readFileSync(new URL('../src/v1_entry.js', import.meta.url), 'utf8');

test('storage mode fences unmigrated V1 routes before legacy fallback', () => {
  assert.match(entrypoint, /if \(usePersistenceRuntime && url\.pathname\.startsWith\('\/api\/v1\/'\) && !migratedStorageRuntimePath\(url\.pathname\)\) \{\s*return storageRuntimeUnavailable\('STORAGE_PATH_NOT_MIGRATED'\);/);
  assert.match(entrypoint, /if \(usePersistenceRuntime\) return notFoundResponse\(\);\s*const activeLegacy = legacy \|\| \(await import\('\.\/index\.js'\)\)\.default;/);
});

test('storage mode injects the selected runtime into admin and branding handlers', () => {
  assert.match(entrypoint, /adminHandler\(request, env, \{ ctx, \.\.\.\(usePersistenceRuntime \? \{ persistenceRuntimeFactory, persistenceRuntime: ctx\?\.tradingPersistenceRuntime \|\| null \} : \{\}\) \}\)/);
  assert.match(entrypoint, /if \(usePersistenceRuntime\) return withTradingPersistenceRuntime\(persistenceRuntimeFactory, env, \(runtime\) => publicBrandingHandler\(request, env, \{ persistenceRuntime: runtime \}\), ctx\)/);
  assert.match(entrypoint, /try \{ await runtime\?\.close\?\.\(\); \} catch/);
});

test('storage mode uses Trading repositories and has no Supabase client fallback', () => {
  const storageBranch = entrypoint.indexOf("if (url.pathname === '/api/v1/public/branding')");
  assert.notEqual(storageBranch, -1);
  const branchText = entrypoint.slice(storageBranch, entrypoint.indexOf("if (url.pathname === '/api/v1/internal/source-event')", storageBranch));
  assert.match(branchText, /if \(usePersistenceRuntime\) return withTradingPersistenceRuntime/);
  assert.match(branchText, /publicBrandingHandler\(request, env, \{ persistenceRuntime: runtime \}\)/);
  assert.doesNotMatch(entrypoint, /publicSupabase|createClient\(|SUPABASE_/);
});
