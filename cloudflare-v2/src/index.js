// Retired legacy Worker module. Keep its historical export available for
// routes that deliberately delegate, but never restore a legacy data path.
export { MTProtoListenerNode } from './listener/listener_node.js';
export { TradeStateNode } from './state/trade_state_node.js';
export { MtprotoContainerRuntime } from './sources/mtproto/container_runtime.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: false, reason: 'LEGACY_API_RETIRED' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Not Found', { status: 404 });
  },
  async scheduled() {},
};
