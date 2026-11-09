import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';

test('enterprise portal exposes a reusable updates-only Telegram template builder', () => {
  const html = renderEnterpriseTradingPortal({});
  assert.match(html, /templatePurpose/);
  assert.match(html, /Updates only — no trade signals/);
  assert.match(html, /templateAllowTpHit/);
  assert.match(html, /templateAllowSlHit/);
  assert.match(html, /templateAllowWeeklyRoundup/);
  assert.match(html, /Header \/ heading/);
  assert.match(html, /FROM VIP/);
  assert.match(html, /deliveryPolicy:\{mode:'updates_only',allowedEvents:allowedEvents,prependHeader:true\}/);
});

test('enterprise portal labels update-only templates in template lists and destination assignment', () => {
  const html = renderEnterpriseTradingPortal({});
  assert.match(html, /destinationTemplate/);
  assert.match(html, /Updates only/);
  assert.match(html, /Updates only: /);
  assert.match(html, /Updates-only templates can only be assigned to Telegram channel destinations/);
});

test('enterprise portal template controls keep inline JavaScript parseable', () => {
  const html = renderEnterpriseTradingPortal({});
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;
  assert.ok(scripts.length > 0);
  for (const match of scripts) assert.doesNotThrow(() => new Function(match[1]));
});
  const unusualClosingTag = '<script>globalThis.safe = true;</script' + '\t\n' + ' data-x="1">';
  assert.equal([...unusualClosingTag.matchAll(scriptPattern)].length, 1);
