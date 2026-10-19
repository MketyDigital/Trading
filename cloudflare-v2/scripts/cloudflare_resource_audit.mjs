import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const GRAPHQL = `${API}/graphql`;

export function normalizeWindowDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || ![7, 31].includes(days)) throw new Error('Window must be 7 or 31 days');
  return days;
}

export function isReadOnlyGraphQL(document) {
  return /^\s*query\b/i.test(String(document || ''));
}

export function redactSql(value) {
  return String(value || '')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, '?')
    .replace(/"(?:""|[^"])*"/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export function parseWranglerResources(config) {
  const sections = [];
  let current = { header: '', body: [] };
  for (const line of String(config).split(/\r?\n/)) {
    const match = line.trim().match(/^\[\[([^\]]+)\]\]$|^\[([^\]]+)\]$/);
    if (match) {
      if (current.header || current.body.length) sections.push(current);
      current = { header: match[1] || match[2], body: [] };
    } else current.body.push(line);
  }
  sections.push(current);
  const textOf = (section) => section.body.join('\n');
  const value = (text, key) => text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? null;
  const number = (text, key) => {
    const parsed = Number(text.match(new RegExp(`^${key}\\s*=\\s*(\\d+)`, 'm'))?.[1]);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const named = sections.filter((section) => section.header === 'd1_databases').map((section) => ({
    name: value(textOf(section), 'database_name'), id: value(textOf(section), 'database_id'),
  }));
  const queues = sections.filter((section) => section.header === 'queues.consumers').map((section) => ({
    name: value(textOf(section), 'queue'), maxBatchSize: number(textOf(section), 'max_batch_size'), maxRetries: number(textOf(section), 'max_retries'),
  }));
  const containers = sections.filter((section) => section.header === 'containers').map((section) => ({
    className: value(textOf(section), 'class_name'), maxInstances: number(textOf(section), 'max_instances'),
  }));
  const triggerSection = sections.find((section) => section.header === 'triggers');
  const crons = triggerSection?.body.join('\n').match(/^crons\s*=\s*\[([^\]]*)\]/m)?.[1]
    ?.match(/"[^"]+"/g)?.map((item) => item.slice(1, -1)) || [];
  const topText = sections.find((section) => section.header === '')?.body.join('\n') || '';
  return { workerName: value(topText, 'name'), d1: named, queues, containers, crons };
}

function safeError(error) {
  const status = Number(error?.status || 0);
  const codes = Array.isArray(error?.codes) ? error.codes.filter((code) => Number.isFinite(Number(code))).slice(0, 5) : [];
  return { ok: false, status: status || undefined, codes, message: String(error?.message || 'request failed').slice(0, 180) };
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(`Cloudflare API request failed (${response.status})`);
    error.status = response.status;
    error.codes = data.errors?.map((item) => item.code);
    throw error;
  }
  return data;
}

async function restGet(path, token) {
  return requestJson(`${API}${path}`, token);
}

async function graph(query, variables, token) {
  if (!isReadOnlyGraphQL(query)) throw new Error('Read-only audit accepts GraphQL queries only');
  const result = await requestJson(GRAPHQL, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (result.errors?.length) {
    const error = new Error(`GraphQL rejected ${query.match(/\b(?:query|mutation)\s+(\w+)/)?.[1] || 'query'}`);
    error.codes = result.errors.map((item) => item.extensions?.code || item.message?.slice(0, 100));
    throw error;
  }
  return result.data?.viewer?.accounts?.[0] || {};
}

async function optional(name, fn) {
  try { return { ok: true, data: await fn() }; }
  catch (error) { return { ...safeError(error), name }; }
}

function dayString(date) { return date.toISOString().slice(0, 10); }
async function listD1(token, account) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await restGet(`/accounts/${account}/d1/database?per_page=100&page=${page}`, token);
    all.push(...(result.result || []));
    if (page >= Number(result.result_info?.total_pages || 1)) break;
  }
  return all.map(({ uuid, name, version, num_tables, file_size, created_at }) => ({ id: uuid, name, version, tables: num_tables, storageBytes: file_size, createdAt: created_at }));
}

async function listQueues(token, account) {
  const result = await restGet(`/accounts/${account}/queues`, token);
  return (result.result || []).map(({ queue_id, queue_name, created_on, producers, consumers }) => ({ id: queue_id, name: queue_name, createdAt: created_on, producers: producers?.length || 0, consumers: consumers?.length || 0 }));
}

async function listContainerApps(token, account) {
  const all = [];
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    const suffix = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
    const result = await restGet(`/accounts/${account}/containers/applications?per_page=100${suffix}`, token);
    all.push(...(result.result || []));
    pageToken = result.result_info?.next_page_token || result.result_info?.nextPageToken || '';
    if (!pageToken) break;
  }
  const apps = [];
  for (const app of all) {
    const instances = await optional(`container_instances:${app.id}`, async () => {
      const allInstances = [];
      let instancePageToken = '';
      for (let page = 0; page < 10; page += 1) {
        const pageSuffix = instancePageToken ? `&page_token=${encodeURIComponent(instancePageToken)}` : '';
        const listed = await restGet(`/accounts/${account}/containers/applications/${encodeURIComponent(app.id)}/instances-v2?per_page=100${pageSuffix}`, token);
        allInstances.push(...(listed.result || []));
        instancePageToken = listed.result_info?.next_page_token || listed.result_info?.nextPageToken || '';
        if (!instancePageToken) break;
      }
      return allInstances.map((instance) => ({
        id: instance.id,
        state: instance.status?.state || instance.state || 'unknown',
        startedAt: instance.started_at || null,
        updatedAt: instance.status?.updated_at || instance.updated_at || null,
        runningAgeHours: instance.started_at ? Math.max(0, (Date.now() - Date.parse(instance.started_at)) / 3600000) : null,
        region: instance.location?.region || null,
        location: instance.location?.name || null,
      }));
    });
    const configuration = app.configuration || {};
    apps.push({
      id: app.id,
      name: app.name || null,
      status: app.status || null,
      resources: {
        memory: configuration.memory ?? null,
        disk: configuration.disk ?? null,
        vcpu: configuration.vcpu ?? null,
        maxInstances: configuration.max_instances ?? configuration.maxInstances ?? null,
      },
      instances,
    });
  }
  return apps;
}

async function listWorkers(token, account) {
  const result = await restGet(`/accounts/${account}/workers/scripts`, token);
  return (result.result || []).map((script) => ({ id: script.id || script.name, name: script.id || script.name, createdOn: script.created_on || null, modifiedOn: script.modified_on || null }));
}

async function listDoNamespaces(token, account) {
  const result = await restGet(`/accounts/${account}/workers/durable_objects/namespaces`, token);
  return (result.result || []).map(({ id, name, script, class: className }) => ({ id, name, script, className: className || null }));
}

function queryD1Metrics() {
  return `query ResourceAuditD1($accountTag: String!, $start: Date!, $end: Date!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $start, date_leq: $end}, orderBy: [date_DESC]) {
        dimensions { date databaseId } sum { readQueries writeQueries rowsRead rowsWritten queryBatchResponseBytes queryBatchTimeMs }
      }
      d1StorageAdaptiveGroups(limit: 10000, filter: {date_geq: $start, date_leq: $end}, orderBy: [date_DESC]) {
        dimensions { date databaseId } max { databaseSizeBytes }
      }
      d1QueriesAdaptiveGroups(limit: 100, filter: {date_geq: $start, date_leq: $end}, orderBy: [sum_rowsWritten_DESC]) {
        dimensions { databaseId query } count sum { rowsRead rowsWritten } avg { queryDurationMs rowsRead rowsWritten }
      }
    } }
  }`;
}

function queryWorker(workerName) {
  return `query ResourceAuditWorker($accountTag: String!, $start: String!, $end: String!, $scriptName: String!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      workersInvocationsAdaptive(limit: 1000, filter: {scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end}) {
        dimensions { scriptName status }
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
    } }
  }`;
}

function queryQueueMetrics() {
  return `query ResourceAuditQueues($accountTag: String!, $start: Time!, $end: Time!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      queueMessageOperationsAdaptiveGroups(limit: 1000, filter: {datetime_geq: $start, datetime_leq: $end}) {
        dimensions { queueID actionType outcome datetimeHour }
        sum { billableOperations bytes } avg { lagTime retryCount } max { messageSize }
      }
      queuesBacklogAdaptiveGroups(limit: 1000, filter: {datetime_geq: $start, datetime_leq: $end}) {
        dimensions { queueID datetimeHour } avg { messages bytes }
      }
      queueConsumerMetricsAdaptiveGroups(limit: 1000, filter: {datetime_geq: $start, datetime_leq: $end}) {
        dimensions { queueID datetimeHour } avg { concurrency }
      }
    } }
  }`;
}

function queryDoMetrics(workerName, start, end) {
  return `query ResourceAuditDO($accountTag: String!, $start: Date!, $end: Date!, $scriptName: String!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: {date_geq: $start, date_leq: $end, scriptName: $scriptName}) {
        dimensions { date namespaceId className } sum { requests responseBodySize }
      }
      durableObjectsPeriodicGroups(limit: 1000, filter: {date_geq: $start, date_leq: $end, scriptName: $scriptName}) {
        dimensions { date namespaceId className } sum { cpuTime }
      }
      durableObjectsStorageGroups(limit: 1000, filter: {date_geq: $start, date_leq: $end, scriptName: $scriptName}) {
        dimensions { date namespaceId className } max { storedBytes }
      }
    } }
  }`;
}

function queryContainerMetrics() {
  return `query ResourceAuditContainers($accountTag: String!, $start: Date!, $end: Date!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      containersMetricsAdaptiveGroups(limit: 1000, filter: {date_geq: $start, date_leq: $end}, orderBy: [date_DESC]) {
        dimensions { date applicationId instanceId } sum { cpuTimeSec allocatedMemory allocatedDisk allocatedCpu containerUptime } max { memory diskUsage } quantiles { cpuUtilizationP95 memoryP95 containerUptimeP95 }
      }
      containersUsageAdaptiveGroups(limit: 1000, filter: {date_geq: $start, date_leq: $end}, orderBy: [date_DESC]) {
        dimensions { date applicationId instanceId } sum { cpuTimeSec allocatedMemory allocatedDisk txBytes }
      }
    } }
  }`;
}

function buildReport({ windowDays, generatedAt, inventory, metrics }) {
  const queryInsight = metrics.d1?.data?.d1QueriesAdaptiveGroups;
  if (Array.isArray(queryInsight)) {
    for (const item of queryInsight) {
      if (item.dimensions?.query) item.dimensions.query = redactSql(item.dimensions.query);
    }
  }
  return {
    generatedAt,
    windowDays,
    readOnly: true,
    scope: 'Cloudflare account resource inventory and aggregated usage; no application rows or message bodies queried',
    configuration: inventory,
    resources: metrics.resources,
    metrics: {
      d1: metrics.d1,
      worker: metrics.worker,
      queues: metrics.queues,
      durableObjects: metrics.durableObjects,
      containers: metrics.containers,
    },
    interpretations: [
      'D1 query counts and row totals are Cloudflare analytics; top query signatures have SQL literals redacted.',
      'Queue retries are shown as Cloudflare analytics averages, and current backlog is also queried from the read-only Queue metrics endpoint.',
      'Worker CPU time is represented by Cloudflare CPU percentiles and status counts; it is not a per-request CPU bill estimate.',
      'Container inventory includes instance state and start/update timestamps; Containers usage analytics shows allocated resources and CPU time.',
      'Durable Object analytics may aggregate WebSocket connections at close, so live open connection age is represented through periodic metrics and application/container state where available.',
    ],
  };
}

export async function runAudit({ token, account, days, configPath = '../wrangler.toml', now = new Date() }) {
  if (!token || !account) throw new Error('Cloudflare credentials are not configured');
  const windowDays = normalizeWindowDays(days);
  const config = fs.readFileSync(new URL(configPath, import.meta.url), 'utf8');
  const inventory = parseWranglerResources(config);
  const startDate = new Date(now.getTime() - windowDays * 86400000);
  const start = dayString(startDate);
  const end = dayString(now);
  const startTime = startDate.toISOString();
  const endTime = now.toISOString();

  const [d1, queues, workers, namespaces, containers, d1Metrics, workerMetrics, queueMetrics, doMetrics, containerMetrics] = await Promise.all([
    optional('d1_inventory', () => listD1(token, account)),
    optional('queue_inventory', () => listQueues(token, account)),
    optional('worker_inventory', () => listWorkers(token, account)),
    optional('durable_object_namespace_inventory', () => listDoNamespaces(token, account)),
    optional('container_inventory', () => listContainerApps(token, account)),
    optional('d1_analytics', () => graph(queryD1Metrics(), { accountTag: account, start, end }, token)),
    optional('worker_analytics', () => graph(queryWorker(inventory.workerName), { accountTag: account, start: startTime, end: endTime, scriptName: inventory.workerName }, token)),
    optional('queue_analytics', () => graph(queryQueueMetrics(), { accountTag: account, start: startTime, end: endTime }, token)),
    optional('durable_object_analytics', () => graph(queryDoMetrics(inventory.workerName, start, end), { accountTag: account, start, end, scriptName: inventory.workerName }, token)),
    optional('container_analytics', () => graph(queryContainerMetrics(), { accountTag: account, start, end }, token)),
  ]);
  const resources = { d1, queues, workers, durableObjectNamespaces: namespaces, containers };
  const metrics = { resources, d1: d1Metrics, worker: workerMetrics, queues: queueMetrics, durableObjects: doMetrics, containers: containerMetrics };
  const report = buildReport({ windowDays, generatedAt: now.toISOString(), inventory, metrics });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await runAudit({
      token: process.env.CLOUDFLARE_API_TOKEN,
      account: process.env.CLOUDFLARE_ACCOUNT_ID,
      days: process.env.AUDIT_WINDOW_DAYS,
    });
    fs.mkdirSync(process.env.REPORT_DIR || '.', { recursive: true });
    const output = `${process.env.REPORT_DIR || '.'}/cloudflare-resource-audit.json`;
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Read-only Cloudflare audit report written to ${output}`);
    const failed = Object.values(report.resources).some((value) => value?.ok === false)
      || Object.entries(report.metrics).some(([key, value]) => key !== 'resources' && value?.ok === false);
    if (failed) console.warn('Some read-only resource or analytics APIs were unavailable; see sanitized report status.');
  } catch (error) {
    console.error(`Audit failed: ${String(error?.message || 'unexpected error').replace(/[\r\n]/g, ' ').slice(0, 200)}`);
    process.exitCode = 1;
  }
}
