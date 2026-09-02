import { createSourceEventQueue } from './source_event_queue.js';

function queueMessages(batch) {
  return Array.isArray(batch?.messages) ? batch.messages : [];
}

export function createSourceQueueConsumer({
  sourceResolver,
  dispatch,
  now = Date.now,
} = {}) {
  if (typeof sourceResolver !== 'function') {
    throw new TypeError('sourceResolver is required');
  }
  if (typeof dispatch !== 'function') {
    throw new TypeError('dispatch is required');
  }

  const transport = createSourceEventQueue({
    sourceStore: {
      getActiveSource: sourceResolver,
    },
    dispatch,
  });

  return async function consumeQueueBatch(batch) {
    let acknowledged = 0;
    let retried = 0;
    const messages = queueMessages(batch);

    for (const message of messages) {
      try {
        await transport.consumeSourceEvent(message?.body, { nowMs: Number(now()) });
        if (typeof message?.ack === 'function') message.ack();
        acknowledged += 1;
      } catch (error) {
        console.warn('Source queue message retry:', error?.message || error);
        if (typeof message?.retry === 'function') message.retry();
        retried += 1;
      }
    }

    return {
      processed: messages.length,
      acknowledged,
      retried,
    };
  };
}
