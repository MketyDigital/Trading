import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

test('ingest gives ambiguous AI interpretation the default 12 second budget', async () => {
  const source = { id: 'source-db-1', workspace_id: 'ws-1', source_instance_id: 'source-1', source_type: 'custom_webhook', secret: 'shared-secret' };
  const payload = { external_event_id: 'msg-timeout', text: 'Buy gold if this setup is confirmed. Entry 2526, risk 2518, objectives 2530 and 2535' };
  const rawBody = JSON.stringify(payload);
  const timestamp = '1700000000000';
  const signature = await signSourcePayload(rawBody, timestamp, source.secret);
  let seenTimeout;

  const result = await ingestTradingEvent({ rawBody, sourceId: 'source-1', timestamp, signature, nowMs: Number(timestamp) }, {
    sourceStore: { getActiveSource: async () => source },
    eventStore: { reserve: async () => ({ ok: true, duplicate: false, eventId: 'event-1' }), updateInterpretation: async () => {} },
    aiRouter: { processSignal: async (_text, _prompt, options) => {
      seenTimeout = options.timeoutMs;
      return { success: false, error: 'AI_PROVIDER_UNAVAILABLE' };
    } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.interpretation.status, 'NEEDS_REVIEW');
  assert.equal(seenTimeout, 12000);
});
