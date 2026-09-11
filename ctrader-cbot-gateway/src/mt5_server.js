import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createMt5ReconnectToken, verifyMt5ConnectionToken, validateMt5Command } from './mt5_protocol.js';

const wsPort = Number(process.env.MT5_CONNECTOR_WS_PORT || 25347);
const wsHost = process.env.MT5_CONNECTOR_WS_HOST || '0.0.0.0';
const controlPort = Number(process.env.MT5_CONNECTOR_CONTROL_PORT || 8791);
const controlHost = process.env.MT5_CONNECTOR_CONTROL_HOST || '0.0.0.0';
const signingKey = process.env.CBOT_TOKEN_SIGNING_KEY || '';
const controlSecret = process.env.CBOT_CONTROL_SECRET || '';
const commandTimeoutMs = Number(process.env.MT5_CONNECTOR_COMMAND_TIMEOUT_MS || process.env.CBOT_COMMAND_TIMEOUT_MS || 8000);
const contextTimeoutMs = Number(process.env.MT5_CONNECTOR_CONTEXT_TIMEOUT_MS || 5000);
const reconnectTtlMs = Number(process.env.MT5_CONNECTOR_RECONNECT_TTL_MS || 90 * 24 * 60 * 60 * 1000);
const maxSymbols = 2000;

if (!signingKey || !controlSecret) {
  console.error('CBOT_TOKEN_SIGNING_KEY and CBOT_CONTROL_SECRET are required for MT5 connector gateway');
  process.exit(1);
}

const sessions = new Map();
const pending = new Map();
const pendingContext = new Map();
const delivered = new Map();
const consumedPairTokens = new Map();

function json(response, status, body) {
  const raw = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(raw), 'Cache-Control': 'no-store' });
  response.end(raw);
}
function authorizedControl(request) {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') && header.slice(7) === controlSecret;
}
function commandKey(accountRowId, commandId) { return `${accountRowId}:${commandId}`; }
function contextKey(accountRowId, requestId) { return `${accountRowId}:${requestId}`; }
function pruneDelivered(now = Date.now()) { for (const [key, expiresAt] of delivered.entries()) if (expiresAt < now) delivered.delete(key); }
function pruneConsumedPairTokens(now = Date.now()) { for (const [key, expiresAt] of consumedPairTokens.entries()) if (expiresAt < now) consumedPairTokens.delete(key); }
function pairTokenKey(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function clearSession(socket) {
  if (!socket.mketyAccountRowId) return;
  const current = sessions.get(socket.mketyAccountRowId);
  if (current?.socket === socket) sessions.delete(socket.mketyAccountRowId);
}
function finiteOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function sanitizeSymbols(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const platformSymbol = String(raw.platformSymbol ?? raw.symbol ?? raw.name ?? '').trim();
    if (!platformSymbol || seen.has(platformSymbol.toUpperCase())) continue;
    seen.add(platformSymbol.toUpperCase());
    const row = { platformSymbol };
    if (String(raw.description ?? '').trim()) row.description = String(raw.description).trim().slice(0, 240);
    if (typeof raw.tradable === 'boolean') row.tradable = raw.tradable;
    for (const key of ['minVolume', 'maxVolume', 'stepVolume', 'minLots', 'maxLots', 'stepLots', 'tickSize', 'tickValue', 'tickValueLoss', 'tickValueProfit', 'contractSize', 'digits']) {
      const value = finiteOrNull(raw[key]);
      if (value !== null) row[key] = value;
    }
    for (const key of ['currencyBase', 'currencyProfit', 'currencyMargin']) {
      const value = String(raw[key] ?? '').trim();
      if (value) row[key] = value.slice(0, 32);
    }
    out.push(row);
    if (out.length >= maxSymbols) break;
  }
  return out;
}
function sessionIdentity(message = {}) {
  return {
    accountNumber: String(message.accountNumber ?? '').trim(),
    serverName: String(message.serverName ?? '').trim() || null,
    brokerName: String(message.brokerName ?? '').trim() || null,
    isLive: Boolean(message.isLive),
    terminalName: String(message.terminalName ?? '').trim() || null,
    connectorInstanceId: String(message.connectorInstanceId ?? '').trim() || null,
    symbols: sanitizeSymbols(message.symbols),
    symbolsUpdatedAt: Date.now(),
  };
}
function safeContext(context, expectedIdentity) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  const accountRaw = context.account && typeof context.account === 'object' ? context.account : {};
  const accountNumber = String(accountRaw.accountNumber ?? '').trim();
  const serverName = String(accountRaw.serverName ?? '').trim();
  if (!accountNumber || accountNumber !== String(expectedIdentity?.accountNumber ?? '')) return null;
  if (!serverName || serverName !== String(expectedIdentity?.serverName ?? '')) return null;
  const account = {
    accountNumber,
    serverName,
    brokerName: String(accountRaw.brokerName ?? expectedIdentity?.brokerName ?? '').trim() || null,
    isLive: Boolean(accountRaw.isLive),
  };
  for (const key of ['balance', 'equity', 'marginFree', 'leverage']) {
    const value = finiteOrNull(accountRaw[key]);
    if (value !== null) account[key] = value;
  }
  const currency = String(accountRaw.currency ?? '').trim();
  if (currency) account.currency = currency.slice(0, 16);
  const symbols = sanitizeSymbols([context.symbol]);
  if (symbols.length !== 1) return null;
  const tick = {};
  for (const key of ['ask', 'bid', 'last']) {
    const value = finiteOrNull(context?.tick?.[key]);
    if (value !== null && value > 0) tick[key] = value;
  }
  return { account, symbol: symbols[0], tick };
}

const wsServer = new WebSocketServer({ port: wsPort, host: wsHost, path: '/v1/mt5' });
wsServer.on('connection', (socket) => {
  socket.authenticated = false;
  const timer = setTimeout(() => { if (!socket.authenticated) socket.close(1008, 'AUTH_REQUIRED'); }, 5000);
  socket.on('message', (data, isBinary) => {
    if (isBinary) return socket.close(1003, 'TEXT_ONLY');
    let message;
    try { message = JSON.parse(data.toString()); } catch { return socket.close(1007, 'INVALID_JSON'); }
    if (!socket.authenticated) {
      if (message?.type !== 'auth') return socket.close(1008, 'AUTH_REQUIRED');
      const suppliedToken = String(message.connectionToken || '');
      const verified = verifyMt5ConnectionToken(suppliedToken, signingKey);
      if (!verified.ok) return socket.close(1008, verified.reason);
      const identity = sessionIdentity(message);
      if (!identity.accountNumber || !identity.serverName) return socket.close(1008, 'ACCOUNT_ID_REQUIRED');
      if (!identity.connectorInstanceId) return socket.close(1008, 'CONNECTOR_INSTANCE_ID_REQUIRED');
      if (verified.purpose === 'reconnect' && verified.connectorInstanceId !== identity.connectorInstanceId) {
        return socket.close(1008, 'CONNECTOR_INSTANCE_MISMATCH');
      }
      if (verified.purpose === 'pair') {
        pruneConsumedPairTokens();
        const tokenKey = pairTokenKey(suppliedToken);
        if (consumedPairTokens.has(tokenKey)) return socket.close(1008, 'PAIR_TOKEN_ALREADY_USED');
        consumedPairTokens.set(tokenKey, verified.expiresAt);
      }
      clearTimeout(timer);
      socket.authenticated = true;
      socket.mketyAccountRowId = verified.accountRowId;
      const previous = sessions.get(verified.accountRowId);
      if (previous?.socket?.readyState === WebSocket.OPEN && previous.socket !== socket) previous.socket.close(1008, 'REPLACED_BY_NEW_SESSION');
      sessions.set(verified.accountRowId, { socket, identity, connectedAt: Date.now(), lastHeartbeatAt: Date.now() });
      const authResponse = { type: 'auth_ok', accountRowId: verified.accountRowId };
      if (verified.purpose === 'pair') {
        authResponse.reconnectToken = createMt5ReconnectToken({
          accountRowId: verified.accountRowId,
          connectorInstanceId: identity.connectorInstanceId,
          expiresAt: Date.now() + reconnectTtlMs,
        }, signingKey);
      }
      socket.send(JSON.stringify(authResponse));
      return;
    }
    const session = sessions.get(socket.mketyAccountRowId);
    if (message?.type === 'heartbeat') {
      if (session) session.lastHeartbeatAt = Date.now();
      return socket.send(JSON.stringify({ type: 'heartbeat_ack', at: Date.now() }));
    }
    if (message?.type === 'symbols') {
      if (session) session.identity = { ...session.identity, symbols: sanitizeSymbols(message.symbols), symbolsUpdatedAt: Date.now() };
      return socket.send(JSON.stringify({ type: 'symbols_ack', count: session?.identity?.symbols?.length || 0, at: Date.now() }));
    }
    if (message?.type === 'context_result' && message.requestId) {
      const key = contextKey(socket.mketyAccountRowId, message.requestId);
      const waiter = pendingContext.get(key);
      if (!waiter) return;
      pendingContext.delete(key);
      clearTimeout(waiter.timer);
      if (message.ok === false) return waiter.resolve({ ok: false, reason: String(message.reason || 'MT5_CONTEXT_FAILED') });
      const context = safeContext(message.context, session?.identity);
      if (!context) return waiter.resolve({ ok: false, reason: 'MT5_CONTEXT_IDENTITY_INVALID' });
      return waiter.resolve({ ok: true, context });
    }
    if (message?.type === 'result' && message.commandId) {
      const key = commandKey(socket.mketyAccountRowId, message.commandId);
      const waiter = pending.get(key);
      if (!waiter) return;
      pending.delete(key); clearTimeout(waiter.timer); waiter.resolve(message);
    }
  });
  socket.on('close', () => { clearTimeout(timer); clearSession(socket); });
  socket.on('error', () => clearSession(socket));
});

const controlServer = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, service: 'mkety-mt5-connector-gateway' });
  if (!authorizedControl(request)) return json(response, 401, { ok: false, reason: 'CONTROL_AUTH_INVALID' });
  const statusMatch = url.pathname.match(/^\/v1\/mt5-connections\/([^/]+)$/);
  if (request.method === 'GET' && statusMatch) {
    const id = decodeURIComponent(statusMatch[1]); const session = sessions.get(id);
    if (!session || session.socket.readyState !== WebSocket.OPEN) return json(response, 404, { ok: false, reason: 'MT5_CONNECTOR_OFFLINE' });
    return json(response, 200, { ok: true, online: true, accountRowId: id, identity: session.identity, connectedAt: session.connectedAt, lastHeartbeatAt: session.lastHeartbeatAt });
  }
  const contextMatch = url.pathname.match(/^\/v1\/mt5-context\/([^/]+)$/);
  if (request.method === 'GET' && contextMatch) {
    const id = decodeURIComponent(contextMatch[1]);
    const symbol = String(url.searchParams.get('symbol') || '').trim();
    if (!symbol) return json(response, 400, { ok: false, reason: 'SYMBOL_REQUIRED' });
    const session = sessions.get(id);
    if (!session || session.socket.readyState !== WebSocket.OPEN) return json(response, 404, { ok: false, reason: 'MT5_CONNECTOR_OFFLINE' });
    const requestId = crypto.randomUUID();
    const key = contextKey(id, requestId);
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pendingContext.delete(key); reject(new Error('MT5_CONTEXT_TIMEOUT')); }, contextTimeoutMs);
        pendingContext.set(key, { resolve, reject, timer });
        session.socket.send(JSON.stringify({ type: 'context_request', requestId, symbol }));
      });
      return json(response, result.ok === false ? 409 : 200, { ...result, accountRowId: id });
    } catch (error) {
      return json(response, 504, { ok: false, reason: error.message || 'MT5_CONTEXT_TIMEOUT' });
    }
  }
  const commandMatch = url.pathname.match(/^\/v1\/mt5-commands\/([^/]+)$/);
  if (request.method === 'POST' && commandMatch) {
    const id = decodeURIComponent(commandMatch[1]);
    let raw=''; for await (const chunk of request) { raw += chunk; if (raw.length > 512*1024) return json(response,413,{ok:false,reason:'BODY_TOO_LARGE'}); }
    let envelope; try { envelope = JSON.parse(raw || '{}'); } catch { return json(response,400,{ok:false,reason:'INVALID_JSON'}); }
    const valid = validateMt5Command(envelope, id); if (!valid.ok) return json(response,400,{ok:false,reason:valid.reason});
    const session = sessions.get(id); if (!session || session.socket.readyState !== WebSocket.OPEN) return json(response,409,{ok:false,reason:'MT5_CONNECTOR_OFFLINE'});
    if (String(envelope.broker_account_id) !== String(session.identity?.accountNumber ?? '')) return json(response,409,{ok:false,reason:'MT5_BROKER_ACCOUNT_MISMATCH'});
    const key = commandKey(id, envelope.command_id); pruneDelivered();
    if (pending.has(key) || delivered.has(key)) return json(response,409,{ok:false,reason:'COMMAND_ALREADY_DELIVERED'});
    delivered.set(key, Number(envelope.expires_at));
    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(key); reject(new Error('MT5_RESULT_TIMEOUT')); }, commandTimeoutMs);
        pending.set(key, { resolve, reject, timer }); session.socket.send(JSON.stringify({ type:'command', envelope }));
      });
      return json(response, result.ok === false ? 409 : 200, result);
    } catch (error) { return json(response,504,{ok:false,reason:error.message || 'MT5_RESULT_TIMEOUT'}); }
  }
  return json(response,404,{ok:false,reason:'NOT_FOUND'});
});

controlServer.listen(controlPort, controlHost, () => console.log(`MT5 connector control API listening on ${controlHost}:${controlPort}`));
console.log(`MT5 connector WebSocket gateway listening on ${wsHost}:${wsPort}`);

export function shutdownMt5Gateway() {
  for (const { socket } of sessions.values()) { try { socket.close(1001,'SERVER_SHUTDOWN'); } catch {} }
  wsServer.close(); controlServer.close();
}
