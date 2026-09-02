import { buildApplicationAuthMessage, buildAccountAuthMessage } from './ctrader_protocol.js';

const OPEN = 1;
const ERROR_PAYLOAD_TYPES = new Set([2132, 2142]);

export class CTraderJsonSession {
  constructor({
    endpoint,
    clientId,
    clientSecret,
    socketFactory = (url) => new WebSocket(url),
    heartbeatScheduler = (fn, ms) => setInterval(fn, ms),
    heartbeatCanceller = (id) => clearInterval(id),
    heartbeatMs = 10000,
    requestTimeoutMs = 10000,
    maxBufferedEvents = 100,
  } = {}) {
    if (!endpoint || !clientId || !clientSecret) throw new TypeError('cTrader endpoint, clientId and clientSecret are required');
    this.endpoint = endpoint;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.socketFactory = socketFactory;
    this.heartbeatScheduler = heartbeatScheduler;
    this.heartbeatCanceller = heartbeatCanceller;
    this.heartbeatMs = heartbeatMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxBufferedEvents = Math.max(1, Number(maxBufferedEvents) || 100);
    this.socket = null;
    this.pending = new Map();
    this.eventBuffer = [];
    this.eventWaiters = new Set();
    this.eventSubscribers = new Set();
    this.sequence = 0;
    this.heartbeatHandle = null;
    this.isApplicationAuthenticated = false;
    this.authenticatedAccounts = new Set();
    this.openingPromise = null;
  }

  nextClientMsgId(prefix = 'mkety') {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }

  async open() {
    if (this.isApplicationAuthenticated && this.socket?.readyState === OPEN) return this;
    if (this.openingPromise) return this.openingPromise;

    this.openingPromise = (async () => {
      this.socket = this.socketFactory(this.endpoint);
      this.attachSocketListeners(this.socket);
      await this.waitForOpen(this.socket);
      this.startHeartbeat();

      const response = await this.request(
        buildApplicationAuthMessage(this.clientId, this.clientSecret, this.nextClientMsgId('app-auth')),
        { successPayloadTypes: [2101] }
      );
      if (response.payloadType !== 2101) throw new Error('cTrader application authentication failed');
      this.isApplicationAuthenticated = true;
      return this;
    })();

    try {
      return await this.openingPromise;
    } finally {
      this.openingPromise = null;
    }
  }

  async authenticateAccount(accountId, accessToken) {
    if (!this.isApplicationAuthenticated) throw new Error('cTrader application must authenticate first');
    const numericAccountId = Number(accountId);
    const response = await this.request(
      buildAccountAuthMessage(numericAccountId, accessToken, this.nextClientMsgId('account-auth')),
      { successPayloadTypes: [2103] }
    );
    this.authenticatedAccounts.add(numericAccountId);
    return response;
  }

  request(message, { successPayloadTypes = [], timeoutMs = this.requestTimeoutMs } = {}) {
    if (!message?.clientMsgId) throw new TypeError('clientMsgId is required');
    if (!this.socket || this.socket.readyState !== OPEN) return Promise.reject(new Error('cTrader connection is not open'));
    if (this.pending.has(message.clientMsgId)) return Promise.reject(new Error(`duplicate clientMsgId: ${message.clientMsgId}`));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(message.clientMsgId);
        reject(new Error(`cTrader request timed out: ${message.clientMsgId}`));
      }, timeoutMs);

      this.pending.set(message.clientMsgId, {
        successPayloadTypes: new Set(successPayloadTypes),
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        this.pending.delete(message.clientMsgId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  waitForEvent(predicate, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (typeof predicate !== 'function') throw new TypeError('event predicate is required');

    const existingIndex = this.eventBuffer.findIndex((message) => {
      try { return Boolean(predicate(message)); } catch { return false; }
    });
    if (existingIndex >= 0) {
      const [message] = this.eventBuffer.splice(existingIndex, 1);
      return Promise.resolve(message);
    }

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: null, reject: null, timeout: null };
      waiter.resolve = (message) => {
        clearTimeout(waiter.timeout);
        this.eventWaiters.delete(waiter);
        resolve(message);
      };
      waiter.reject = (error) => {
        clearTimeout(waiter.timeout);
        this.eventWaiters.delete(waiter);
        reject(error);
      };
      waiter.timeout = setTimeout(() => {
        waiter.reject(new Error('cTrader event wait timed out'));
      }, timeoutMs);
      this.eventWaiters.add(waiter);
    });
  }

  subscribeEvents(handler) {
    if (typeof handler !== 'function') throw new TypeError('event subscriber is required');
    this.eventSubscribers.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.eventSubscribers.delete(handler);
    };
  }

  notifyEventSubscribers(message) {
    for (const handler of [...this.eventSubscribers]) {
      try {
        handler(message);
      } catch {
        // Source/event observers are intentionally isolated from request
        // correlation, waiter delivery, and sibling observers.
      }
    }
  }

  dispatchEvent(message) {
    this.notifyEventSubscribers(message);

    for (const waiter of [...this.eventWaiters]) {
      let matched = false;
      try { matched = Boolean(waiter.predicate(message)); } catch { matched = false; }
      if (matched) {
        waiter.resolve(message);
        return;
      }
    }

    this.eventBuffer.push(message);
    if (this.eventBuffer.length > this.maxBufferedEvents) {
      this.eventBuffer.splice(0, this.eventBuffer.length - this.maxBufferedEvents);
    }
  }

  attachSocketListeners(socket) {
    socket.addEventListener('message', (event) => this.handleMessage(event));
    socket.addEventListener('close', () => this.handleConnectionClosed());
    socket.addEventListener('error', () => this.handleConnectionClosed('cTrader connection error'));
  }

  waitForOpen(socket) {
    if (socket.readyState === OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener?.('open', onOpen);
        socket.removeEventListener?.('error', onError);
        resolve();
      };
      const onError = () => {
        socket.removeEventListener?.('open', onOpen);
        socket.removeEventListener?.('error', onError);
        reject(new Error('failed to open cTrader connection'));
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }

  handleMessage(event) {
    let message;
    try {
      message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }

    // Preserve every broker/server event independently of request correlation.
    // cTrader fills can arrive without clientMsgId, and may race the accepted
    // response, so execution consumers need a bounded event stream as well.
    this.dispatchEvent(message);

    const clientMsgId = message?.clientMsgId;
    if (!clientMsgId || !this.pending.has(clientMsgId)) return;
    const pending = this.pending.get(clientMsgId);

    if (ERROR_PAYLOAD_TYPES.has(Number(message.payloadType)) || message?.payload?.errorCode) {
      this.pending.delete(clientMsgId);
      const code = message?.payload?.errorCode || 'CTRADER_ERROR';
      const description = message?.payload?.description || 'cTrader request failed';
      pending.reject(new Error(`${code}: ${description}`));
      return;
    }

    if (pending.successPayloadTypes.size === 0 || pending.successPayloadTypes.has(Number(message.payloadType))) {
      this.pending.delete(clientMsgId);
      pending.resolve(message);
    }
  }

  startHeartbeat() {
    if (this.heartbeatHandle != null) return;
    this.heartbeatHandle = this.heartbeatScheduler(() => {
      if (this.socket?.readyState === OPEN) {
        this.socket.send(JSON.stringify({ payloadType: 51 }));
      }
    }, this.heartbeatMs);
  }

  handleConnectionClosed(reason = 'cTrader connection closed') {
    if (this.heartbeatHandle != null) {
      this.heartbeatCanceller(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    this.isApplicationAuthenticated = false;
    this.authenticatedAccounts.clear();
    for (const [clientMsgId, pending] of this.pending) {
      this.pending.delete(clientMsgId);
      pending.reject(new Error(reason));
    }
    for (const waiter of [...this.eventWaiters]) {
      waiter.reject(new Error(reason));
    }
    this.eventBuffer.length = 0;
  }

  close() {
    this.handleConnectionClosed();
    try { this.socket?.close?.(); } catch {}
    this.socket = null;
  }
}
