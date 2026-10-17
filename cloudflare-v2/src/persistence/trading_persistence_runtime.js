import { resolveTradingStorageAuthority } from './trading_storage_authority.js';
import { createPostgresTradingDatabase } from './postgres_database.js';
import { createTradingAccessCodeRepository } from './trading_access_code_repository.js';
import { createTradingAccountRepository } from './trading_account_repository.js';
import { createTradingAIProviderRepository } from './trading_ai_provider_repository.js';
import { createTradingCTraderOAuthStateRepository } from './trading_ctrader_oauth_state_repository.js';
import { createTradingDeliveryRepository } from './trading_delivery_repository.js';
import { listTradingBindingRepairs, listTradingDeliveryRetries } from './trading_delivery_retry_scanner.js';
import { createTradingDestinationRepository } from './trading_destination_repository.js';
import { createTradingHostnameRepository } from './trading_hostname_repository.js';
import { createTradingIngestStores } from './trading_ingest_repository.js';
import { createTradingIngressCollectorRepository } from './trading_ingress_collector_repository.js';
import { createTradingLegacyWorkspaceRepository } from './trading_legacy_workspace_repository.js';
import { createTradingOperationJournalRepository } from './trading_operation_journal_repository.js';
import { createTradingRecoveryCursorRepository } from './trading_recovery_cursor_repository.js';
import { createTradingRouteRepository } from './trading_route_repository.js';
import { createTradingRuntimeControlStore } from './trading_runtime_control_store.js';
import { createTradingSourceConnectionRepository } from './trading_source_connection_repository.js';
import { createTradingSourceFeedRepository } from './trading_source_feed_repository.js';
import { createTradingTradeStatePersistence } from './trading_trade_state_repository.js';
import { createTradingVIPRepository } from './trading_vip_repository.js';
import { createTradingWorkspaceAccessRepository } from './trading_workspace_access_repository.js';

/**
 * Build the repositories for exactly one authoritative database. This factory
 * deliberately does not create a Supabase client or fall back to another store.
 * Worker callsites should construct it only after the target schema and persisted
 * authority control row have been provisioned for that environment.
 */
export async function createTradingPersistenceRuntime(env = {}, { postgresDatabase: suppliedDatabase, ClientClass, masterKey = env.TRADING_MASTER_KEY } = {}) {
  const authority = resolveTradingStorageAuthority(env);
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required for encrypted trading data access');
  let postgresDatabase = suppliedDatabase || null;
  let ownsPostgresDatabase = false;
  if (authority.kind === 'postgres' && !postgresDatabase) {
    postgresDatabase = await createPostgresTradingDatabase(authority.binding, { ClientClass });
    ownsPostgresDatabase = true;
  }
  const shared = { authority, postgresDatabase };
  const sourceConnections = createTradingSourceConnectionRepository({ ...shared, masterKey });
  const sourceFeeds = createTradingSourceFeedRepository(shared);
  const destinations = createTradingDestinationRepository(shared);
  const routes = createTradingRouteRepository(shared);
  let stores;
  try {
    stores = {
    authority,
    postgresDatabase,
    accessCodes: createTradingAccessCodeRepository(shared),
    accounts: createTradingAccountRepository(shared),
    aiProviders: createTradingAIProviderRepository(shared),
    cTraderOAuthStates: createTradingCTraderOAuthStateRepository(shared),
    destinations,
    hostnames: createTradingHostnameRepository(shared),
    ingest: createTradingIngestStores({ ...shared, masterKey }),
    ingressCollectors: createTradingIngressCollectorRepository(shared),
    legacyWorkspaces: createTradingLegacyWorkspaceRepository({ ...shared, masterKey }),
    operationJournal: createTradingOperationJournalRepository(shared),
    recoveryCursors: createTradingRecoveryCursorRepository(shared),
    routes,
    runtimeControls: createTradingRuntimeControlStore(shared),
    sourceConnections,
    sourceFeeds,
    adminSources: { sourceConnections, sourceFeeds },
    adminDestinations: { destinations, routes },
    tradeState: createTradingTradeStatePersistence(shared),
    vip: createTradingVIPRepository(shared),
    workspaceAccess: createTradingWorkspaceAccessRepository(shared),
    delivery(options) { return createTradingDeliveryRepository({ ...shared, ...options }); },
    listDueDeliveries(options) { return listTradingDeliveryRetries({ ...shared, ...options }); },
    listBindingRepairs(options) { return listTradingBindingRepairs({ ...shared, ...options }); },
    deliveryHistory: {
      async findTradingEventId(workspaceId, externalEventIdCandidates) {
        const row = await stores.ingest.eventStore.findByExternalEventId(workspaceId, externalEventIdCandidates);
        return row?.id ? String(row.id) : null;
      },
      repository(options) { return createTradingDeliveryRepository({ ...shared, ...options }); },
    },
    async close() { if (ownsPostgresDatabase) await postgresDatabase.close(); },
    };
  } catch (error) {
    if (ownsPostgresDatabase) await postgresDatabase.close();
    throw error;
  }
  return Object.freeze(stores);
}
