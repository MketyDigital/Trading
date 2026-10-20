import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSql, normalizeWindowDays, parseWranglerResources, isReadOnlyGraphQL, utcCalendarWindowStart, queryD1Metrics, queryQueueMetrics, queryContainerMetrics } from '../scripts/cloudflare_resource_audit.mjs';

test('redacts SQL literals and bounds long statements before reporting', () => {
  const sql = `UPDATE sessions SET token='private-token', n=123 WHERE user_id="secret-user"`;
  assert.equal(redactSql(sql), 'UPDATE sessions SET token=?, n=? WHERE user_id=?');
  assert.ok(redactSql('x'.repeat(800)).length <= 500);
});

test('accepts only supported analytics windows', () => {
  assert.equal(normalizeWindowDays('7'), 7);
  assert.equal(normalizeWindowDays('31'), 31);
  assert.throws(() => normalizeWindowDays('32'), /7 or 31/);
  assert.throws(() => normalizeWindowDays('7; DROP TABLE'), /7 or 31/);
});

test('calendar analytics window includes exactly the selected number of UTC dates', () => {
  const start = utcCalendarWindowStart(new Date('2026-10-19T13:00:00.000Z'), 7);
  assert.equal(start.toISOString(), '2026-10-13T00:00:00.000Z');
});

test('fails closed unless Cloudflare GraphQL document is a read-only query', () => {
  assert.equal(isReadOnlyGraphQL('query Audit { viewer { accounts { d1AnalyticsAdaptiveGroups(limit: 1, filter: {}) { count } } } }'), true);
  assert.equal(isReadOnlyGraphQL('mutation Audit { deleteThing }'), false);
});

test('D1 analytics query ranks the heaviest query signatures by both rows read and written', () => {
  const query = queryD1Metrics();
  assert.match(query, /d1TopQuerySignaturesByRowsRead: d1QueriesAdaptiveGroups/);
  assert.match(query, /d1TopQuerySignaturesByRowsWritten: d1QueriesAdaptiveGroups/);
  assert.match(query, /sum_rowsRead_DESC/);
  assert.match(query, /sum_rowsWritten_DESC/);
});

test('Queue metrics aggregate across the selected window to avoid hourly result truncation', () => {
  const query = queryQueueMetrics();
  assert.match(query, /queueMessageOperationsAdaptiveGroups\(limit: 1000/);
  assert.match(query, /dimensions \{ queueID actionType outcome \}/);
  assert.match(query, /queuesBacklogAdaptiveGroups\(limit: 1000/);
  assert.match(query, /dimensions \{ queueID \} avg \{ messages bytes \}/);
  assert.match(query, /queueConsumerMetricsAdaptiveGroups\(limit: 1000/);
  assert.doesNotMatch(query, /datetimeHour/);
});

test('Container metrics aggregate per instance over the selected date range', () => {
  const query = queryContainerMetrics();
  assert.match(query, /containersMetricsAdaptiveGroups\(limit: 1000/);
  assert.match(query, /dimensions \{ applicationId instanceId \}/);
  assert.doesNotMatch(query, /dimensions \{ date applicationId instanceId \}/);
});

test('reads only resource identifiers and bounded runtime settings from Wrangler config', () => {
  const inventory = parseWranglerResources(`name = "mkety-copier-engine"\n[[d1_databases]]\ndatabase_name = "trading-staging"\ndatabase_id = "4f00d59a-3d90-4146-832d-36230d5648bb"\n[[containers]]\nclass_name = "MtprotoContainerRuntime"\nmax_instances = 100\n[[queues.consumers]]\nqueue = "mkety-trading-source-events"\nmax_batch_size = 5\nmax_retries = 8\n[triggers]\ncrons = ["* * * * *"]`);
  assert.equal(inventory.workerName, 'mkety-copier-engine');
  assert.deepEqual(inventory.d1.map(({ name }) => name), ['trading-staging']);
  assert.deepEqual(inventory.queues[0], { name: 'mkety-trading-source-events', maxBatchSize: 5, maxRetries: 8 });
  assert.deepEqual(inventory.containers[0], { className: 'MtprotoContainerRuntime', maxInstances: 100 });
  assert.deepEqual(inventory.crons, ['* * * * *']);
});

test('workflow can only be manually run from main and does not request deploy/write permissions', async () => {
  const fs = await import('node:fs');
  const workflow = fs.readFileSync(new URL('../../.github/workflows/cloudflare-resource-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /^\s*(push|schedule|pull_request):/m);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /wrangler deploy|d1 execute|\bPOST\s+.*cloudflare.*\/accounts|DELETE\s+.*cloudflare/i);
  assert.match(workflow, /cloudflare_resource_audit\.mjs/);
});
