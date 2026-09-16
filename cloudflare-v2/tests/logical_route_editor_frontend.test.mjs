import test from 'node:test';
import assert from 'node:assert/strict';

import { withLogicalRouteEditor } from '../src/dashboard_logical_route_editor.js';

const base = '<html><body><section id="granularRoutingPanel"><div class="grid"><div class="formbox"><select id="granularExistingRoute"></select></div></div></section></body></html>';

test('logical route editor exposes one editor for existing and new routes', () => {
  const html = withLogicalRouteEditor(base);
  assert.match(html, /Create or edit route/i);
  assert.match(html, /Existing route/i);
  assert.match(html, /Source connection/i);
  assert.match(html, /All channels from this source/i);
  assert.match(html, /Allowed channels/i);
  assert.match(html, /Destination/i);
  assert.match(html, /Save route/i);
});

test('logical route editor explains strict selective routing and blank symbol filters', () => {
  const html = withLogicalRouteEditor(base);
  assert.match(html, /Only selected channels.*reach this destination/i);
  assert.match(html, /unselected channels.*ignored/i);
  assert.match(html, /Leave both symbol filters blank to allow every symbol this destination account can actually trade/i);
});

test('logical route editor exposes all formatting presets including forward as-is', () => {
  const html = withLogicalRouteEditor(base);
  assert.match(html, /Forward as-is \(original\)/i);
  assert.match(html, /No AI, no cleanup, no reformatting/i);
  assert.match(html, /Clean original/i);
  assert.match(html, /Structured template/i);
  assert.match(html, /AI presentation \+ safe fallback/i);
});

test('logical route editor hides the obsolete one-feed route form instead of removing other granular controls', () => {
  const html = withLogicalRouteEditor(base);
  assert.match(html, /granularExistingRoute/);
  assert.match(html, /closest\('\.formbox'\)/);
  assert.match(html, /style\.display='none'/);
});
