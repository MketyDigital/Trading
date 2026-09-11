import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyMt5ConnectionToken, validateMt5Command } from './mt5_protocol.js';

const wsPort = Number(process.env.MT5_CONNECTOR_WS_PORT || 25347);
const wsHost = process.env.MT5_CONNECTOR_WS_HOST || '0.0.0.0';
const controlPort = Number(process.env.MT5_CONNECTOR_CONTROL_PORT || 8791);
const controlHost = process.env.MT5_CONNECTOR_CONTROL_HOST || '0.0.0.0';
const signingKey = process.env.CBOT_TOKEN_SIGNING_KEY || '';
const controlSecret = process.env.CBOT_CONTROL_SECRET || '';
const commandTimeoutMs = Number(process.env.MT5_CONNECTOR_COMMAND_TIMEOUT_MS || process.env.CBOT_COMMAND_TIMEOUT_MS || 8000);
const maxSymbols = 2000;

const sessions = new Map();
const pending = new Map();
const delivered = new Map();

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
function pruneDelivered(now = Date.now()) { for (const [key, expiresAt] of delivered.entries()) if (expiresAt < now) delivered.delete(key); }
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
    for (const key of ['minVolume', 'maxVolume', 'stepVolume', 'tickSize', 'tickValue', 'digits']) {
      const value = finiteOrNull(raw[key]);
      if (value !== null) row[key] = value;
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
      const verified = verifyMt5ConnectionToken(message.connectionToken, signingKey);
      if (!verified.ok) return socket.close(1008, verified.reason);
      const identity = sessionIdentity(message);
      if (!identity.accountNumber || !identity.serverName) return socket.close(1008, 'ACCOUNT_ID_REQUIRED');
      clearTimeout(timer);
      socket.authenticated = true;
      socket.mketyAccountRowId = verified.accountRowId;
      const previous = sessions.get(verified.accountRowId);
      if (previous?.socket?.readyState === WebSocket.OPEN && previous.socket !== socket) previous.socket.close(1008, 'REPLACED_BY_NEW_SESSION');
      sessions.set(verified.accountRowId, { socket, identity, connectedAt: Date.now(), lastHeartbeatAt: Date.now() });
      socket.send(JSON.stringify({ type: 'auth_ok', accountRowId: verified.accountRowId }));
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
