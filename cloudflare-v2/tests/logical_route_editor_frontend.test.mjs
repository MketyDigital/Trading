import test from 'node:test';
import assert from 'node:assert/strict';

import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';

const base = '<html><body><main></main></body></html>';

test('logical route editor exposes one editor for existing and new routes', () => {
  const html = withGranularRoutingConsole(base);
  assert.match(html, /Create or edit a route/i);
  assert.match(html, /Existing route/i);
  assert.match(html, /Source connection/i);
  assert.match(html, /All channels from this source/i);
  assert.match(html, /Allowed channels \/ feeds/i);
  assert.match(html, /Destination/i);
  assert.match(html, /Save route/i);
});

test('logical route editor explains strict selective routing and blank symbol filters', () => {
  const html = withGranularRoutingConsole(base);
  assert.match(html, /Only checked channels reach this destination/i);
  assert.match(html, /Unchecked channels are skipped for this route/i);
  assert.match(html, /Leave both symbol filters blank to allow every symbol this destination account can actually trade/i);
});

test('logical route editor exposes all formatting presets including forward as-is', () => {
  const html = withGranularRoutingConsole(base);
  assert.match(html, /Forward as-is \(original\)/i);
  assert.match(html, /No AI, no cleanup, no reformatting, no branding/i);
  assert.match(html, /Clean original/i);
  assert.match(html, /Structured template/i);
  assert.match(html, /AI presentation \+ safe fallback/i);
});

test('logical route editor keeps existing granular source, destination, bot and template controls intact', () => {
  const html = withGranularRoutingConsole(base);
  assert.match(html, /Source connections & feeds/i);
  assert.match(html, /Editable destinations/i);
  assert.match(html, /Reusable Telegram delivery bot/i);
  assert.match(html, /Formatting templates/i);
});
