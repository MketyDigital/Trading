import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingV1Entrypoint } from '../src/v1_entry.js';

async function renderedPortal() {
  const worker = createTradingV1Entrypoint();
  const response = await worker.fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
    TRADING_ACCESS_CODE_REDEMPTION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'test-session-secret',
  }, {});
  assert.equal(response.status, 200);
  return response.text();
}

test('composed customer portal inline scripts all parse', async () => {
  const html = await renderedPortal();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length >= 3, `expected composed portal scripts, found ${scripts.length}`);

  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(
      () => new Function(source),
      `inline script ${index + 1} must parse as browser JavaScript`,
    );
  }
});

test('one-time source secret alert keeps newline escaped inside rendered JavaScript', async () => {
  const html = await renderedPortal();
  assert.equal(
    html.includes("alert('Copy this one-time signing secret now:\n'+secret)"),
    false,
    'rendered JavaScript must not contain a literal newline inside the alert string',
  );
  assert.equal(
    html.includes("alert('Copy this one-time signing secret now:\\n'+secret)"),
    true,
    'rendered JavaScript must contain a backslash-n escape inside the alert string',
  );
});

test('customer portal describes deployment broker flag as capability, not an owner master switch', async () => {
  const html = await renderedPortal();
  assert.equal(html.includes('Broker master fuse ON'), false);
  assert.equal(html.includes('Broker capability available'), true);
});

test('visible customer sign-out clears the server refresh session before local session state', async () => {
  const html = await renderedPortal();
  assert.equal(html.includes("fetch('/api/v1/access/logout',{method:'POST',credentials:'include'})"), true);
  assert.match(
    html,
    /logoutBtn[^\n]*access\/logout[^\n]*clearSession\(\)[^\n]*location\.reload\(\)/,
    'the visible Sign out control must clear the HttpOnly refresh session before browser state and reload',
  );
});
