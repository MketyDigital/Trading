import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrangler = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('wrangler binds low-latency source queue producer to Worker', () => {
  assert.match(wrangler, /\[\[queues\.producers\]\][\s\S]*binding\s*=\s*"SOURCE_EVENT_QUEUE"[\s\S]*queue\s*=\s*"mkety-trading-source-events"/);
});

test('wrangler consumes source queue with bounded retries and DLQ', () => {
  assert.match(wrangler, /\[\[queues\.consumers\]\][\s\S]*queue\s*=\s*"mkety-trading-source-events"[\s\S]*max_batch_size\s*=\s*5[\s\S]*max_batch_timeout\s*=\s*1[\s\S]*max_retries\s*=\s*8[\s\S]*dead_letter_queue\s*=\s*"mkety-trading-source-events-dlq"/);
});
