import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { withEnterpriseConnectionEnhancements } from '../src/dashboard_enterprise_enhancements.js';
import { withRoutingAiCompletion } from '../src/dashboard_routing_ai_completion.js';
import { withUserAcceptanceControls } from '../src/dashboard_user_acceptance_controls.js';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';
import { withSimplifiedAccountControls } from '../src/dashboard_simplified_account_controls.js';
import { withCTraderCbotConnections } from '../src/dashboard_ctrader_cbot_connections.js';
import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';
import { withTelegramBotSource } from '../src/dashboard_telegram_bot_source.js';
import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';

const artifacts = process.env.ACCOUNT_BROWSER_ARTIFACTS || 'connected-account-browser-artifacts';
await mkdir(artifacts, { recursive: true });
const accounts = [
  ['ctrader-demo', 'ctrader', 'ctrader_oauth', 'demo', 0.1, 'fixed'],
  ['ctrader-live', 'ctrader', 'ctrader_oauth', 'live', 0.09, 'fixed'],
  ['mt5-demo', 'mt5', 'mt5_connector', 'demo', 0.01, 'fixed'],
  ['mt5-fbs', 'mt5', 'mt5_connector', 'live', 50, 'risk_percent'],
  ['mt5-other-live', 'mt5', 'mt5_connector', 'live', 0.05, 'fixed'],
  ['mt5-other-demo', 'mt5', 'mt5_connector', 'demo', 3.0, 'fixed'],
].map(([id, platform, providerMode, environment, lotValue, lotSizingType]) => ({
  id, label: id, platform, providerMode, providerConfig: { status: 'connected', brokerName: 'Test' },
  accountId: id, serverName: 'Broker-Test', environment, roles: ['source','execution'],
  active: true, isActive: true, executionEnabled: false, killSwitch: true,
  tradingEnabled: false, liveExecutionEnabled: false,
  lotValue, lotSizingType,
  lotSizingConfig: lotSizingType === 'risk_percent' ? { riskMode: 'fixed_cash', riskBasis: 'balance' } : {},
  riskPolicy: lotSizingType === 'risk_percent' ? {
    maxRiskPercent: 10, maxOpenRiskPercent: 20, maxDailyLossPercent: 50,
    minimumLotPolicy: 'FLOOR', minimumVolumeRiskTolerancePercent: 1,
  } : {},
}));
function assemble() {
  let html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: '1', BROKER_EXECUTION_ENABLED: '0' });
  html = withEnterpriseConnectionEnhancements(html);
  html = withRoutingAiCompletion(html);
  html = withUserAcceptanceControls(html);
  html = withUnifiedTradingConnections(html);
  html = withSimplifiedAccountControls(html);
  html = withCTraderCbotConnections(html);
  html = withMt5ConnectorConnections(html);
  html = withTelegramBotSource(html);
  html = withGranularRoutingConsole(html);
  return html;
}
function fixture(path) {
  if (path.endsWith('/admin/connections/accounts')) return { ok: true, riskPolicyEditable: true, accounts };
  if (path.endsWith('/admin/connections')) return { ok: true, readiness: { ctrader: { configured: true }, mt5: { bridge: { configured: true }, cloud: { configured: false } } } };
  if (path.endsWith('/admin/accounts')) return { ok: true, accounts };
  if (path.endsWith('/admin/workspace')) return { ok: true, workspace: { id: 'test-workspace', name: 'Fixture workspace' } };
  if (path.endsWith('/admin/sources')) return { ok: true, sources: [] };
  if (path.endsWith('/admin/destinations')) return { ok: true, destinations: [] };
  if (path.endsWith('/admin/templates')) return { ok: true, templates: [] };
  if (path.endsWith('/admin/routes')) return { ok: true, routes: [] };
  if (path.endsWith('/admin/members')) return { ok: true, members: [] };
  if (path.endsWith('/admin/ai-providers')) return { ok: true, providers: [] };
  if (path.endsWith('/admin/branding')) return { ok: true, branding: {} };
  if (path.endsWith('/admin/operations')) return { ok: true, operations: {} };
  if (path.endsWith('/admin/hostnames')) return { ok: true, hostnames: [] };
  return { ok: true };
}

const watchdog = setTimeout(() => {
  console.error('BROWSER_FATAL: renderer did not complete within 40 seconds (possible MutationObserver loop)');
  process.exit(124);
}, 40_000);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const failures = [];
  const requests = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.addInitScript(() => {
    sessionStorage.setItem('mketyTradingWorkspace', 'fixture-workspace');
    sessionStorage.setItem('mketyTradingBearer', 'fixture-bearer');
    sessionStorage.setItem('mketyTradingEntitlements',
      JSON.stringify({ tradingExecutionDestination: true, telegramDestination: true }));
    sessionStorage.setItem('mketyTradingWorkspaceName', 'Fixture workspace');
    window.__fixtureMutationCount = 0;
    const NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      constructor(callback) {
        super((records, observer) => {
          window.__fixtureMutationCount += 1;
          callback(records, observer);
        });
      }
    };
  });
  const portal = assemble();
  assert.ok(portal.includes('function accountButtons(x){'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: portal });
    requests.push(url.pathname);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(fixture(url.pathname)) });
  });
  await page.goto('http://fixture.mkety.test/', { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.locator('[data-view="connections"]').first().click({ timeout: 5000 });
  await page.locator('#unifiedAccountRows [data-account-id]').first().waitFor({ state: 'visible', timeout: 12000 });
  await page.waitForTimeout(950);
  const observed = await page.evaluate(() => {
    const u = document.getElementById('unifiedConnectionsPanel');
    const cards = Array.from(document.querySelectorAll('#unifiedAccountRows [data-account-id]'));
    const visible = x => x && x.getClientRects().length > 0 && getComputedStyle(x).visibility !== 'hidden';
    const legacy = document.getElementById('accountRows');
    return {
      cardCount: cards.length,
      panelCount: document.querySelectorAll('#unifiedConnectionsPanel').length,
      legacyVisible: Boolean(legacy && visible(legacy.closest('.table-wrap'))),
      panelWidth: u?.getBoundingClientRect().width || 0,
      brokerCardWidth: legacy?.closest('.card')?.getBoundingClientRect().width || 0,
      mutations: window.__fixtureMutationCount,
      mainThreadLive: true,
      accountButtons: cards.map(card => ({
        id: card.getAttribute('data-account-id'),
        actionButtons: Array.from(card.querySelectorAll('button')).filter(visible).map(x => x.textContent.trim()),
        sizingLabel: card.textContent.includes('Sizing:'),
        editorExists: Boolean(card.querySelector('[data-account-sizing-editor]')),
      })),
      otherPanels: {
        operational: document.querySelectorAll('#enterpriseAccountControlRows .formbox').length,
        settings: document.querySelectorAll('#userAccountSettingRows .formbox').length,
      },
    };
  });
  console.log('CONNECTED_ACCOUNT_BROWSER_REPORT=' + JSON.stringify(observed));
  await page.screenshot({ path: artifacts + '/accounts-full-page.png', fullPage: true, timeout: 7000 });
  if (failures.length) console.log('CONNECTED_ACCOUNT_BROWSER_JS_ERRORS=' + JSON.stringify(failures.slice(0,8)));
  assert.equal(observed.cardCount, 6, 'all six representative account cards must render');
  assert.equal(observed.panelCount, 1, 'one unified connection manager');
  assert.ok(observed.accountButtons.every(a => a.editorExists && a.sizingLabel), 'existing sizing editor and summary remain');
  assert.ok(observed.accountButtons.every(a => a.actionButtons.includes('Edit details') && a.actionButtons.includes('Configure sizing')),
    'original actions must be visible on every connection card');
  assert.ok(observed.accountButtons.filter(a => a.id.startsWith('mt5')).every(a =>
    a.actionButtons.includes('Regenerate connection token') && a.actionButtons.includes('Refresh MT5 connection')),
    'MT5 connection actions must be visible');
  assert.ok(observed.accountButtons.filter(a => a.id.startsWith('ctrader')).every(a =>
    !a.actionButtons.includes('Regenerate connection token')), 'non-MT5 cards must not expose MT5 token actions');
  assert.ok(observed.mutations < 200, 'mutation observers must settle promptly');
  assert.deepEqual(failures, [], 'browser script errors must not be swallowed');
  console.log('CONNECTED_ACCOUNT_BROWSER=PASS');
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
