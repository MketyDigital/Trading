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
    this.socket = null;
    this.pending = new Map();
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
  }

  close() {
    this.handleConnectionClosed();
    try { this.socket?.close?.(); } catch {}
    this.socket = null;
  }
}
