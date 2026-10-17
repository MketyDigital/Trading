import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const entrypoint = fs.readFileSync(new URL('../src/v1_connections_entry.js', import.meta.url), 'utf8');

test('MT5 bridge route creates and passes the persistence runtime in storage mode', () => {
  const routeStart = entrypoint.indexOf("if (url.pathname === '/api/v1/external/mt5/bridge'");
  assert.notEqual(routeStart, -1, 'MT5 bridge route must be registered');
  const route = entrypoint.slice(routeStart, entrypoint.indexOf('\n      }', routeStart) + 8);
  assert.match(route, /if \(usePersistenceRuntime\)/);
  assert.match(route, /withTradingPersistenceRuntime\(persistenceRuntimeFactory, env/);
  assert.match(route, /persistenceRuntime: runtime/);
  assert.match(route, /mt5BridgeHandler\(request, env, \{ ctx, persistenceRuntime: ctx\?\.tradingPersistenceRuntime \|\| null \}\)/);
});

test('connection admin source, cTrader OAuth, and broker connector routes receive the persistence runtime', () => {
  assert.match(entrypoint, /url\.pathname\.startsWith\('\/api\/v1\/admin\/connections\/'\) && !supportedConnectorPath[\s\S]*?connectionsHandler\(request, env, \{ ctx, persistenceRuntime: runtime \}\)/);
  assert.match(entrypoint, /ctraderCbotHandler\(request, env, \{ ctx, persistenceRuntime: runtime \}\)/);
  assert.match(entrypoint, /mt5ConnectorHandler\(request, env, \{ ctx, persistenceRuntime: runtime \}\)/);
  assert.match(entrypoint, /if \(isLogicalRouteAdminRequest\(request\)\)[\s\S]*?withTradingPersistenceRuntime\(persistenceRuntimeFactory, env,[\s\S]*?logicalRoutesHandler\(request, env, \{ ctx, persistenceRuntime: runtime \}\)/);
});

test('storage mode keeps edit-in-place routes on the repository-backed handler', () => {
  assert.match(entrypoint, /if \(isEditInPlaceAdminRequest\(request\)\)[\s\S]*?if \(usePersistenceRuntime\) return withTradingPersistenceRuntime\(persistenceRuntimeFactory, env,[\s\S]*?editInPlaceHandler\(request, env, \{ ctx, persistenceRuntime: runtime \}\)/);
});
