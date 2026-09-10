import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyConnectionToken, validateCommand } from './protocol.js';

const wsPort = Number(process.env.CBOT_WS_PORT || 25345);
const controlPort = Number(process.env.CBOT_CONTROL_PORT || 8790);
const signingKey = process.env.CBOT_TOKEN_SIGNING_KEY || '';
const controlSecret = process.env.CBOT_CONTROL_SECRET || '';
const commandTimeoutMs = Number(process.env.CBOT_COMMAND_TIMEOUT_MS || 8000);

if (!signingKey || !controlSecret) {
  console.error('CBOT_TOKEN_SIGNING_KEY and CBOT_CONTROL_SECRET are required');
  process.exit(1);
}

const sessions = new Map();
const pending = new Map();

function json(response, status, body) {
  const raw = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
  });
  response.end(raw);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 512 * 1024) reject(new Error('BODY_TOO_LARGE'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('INVALID_JSON')); }
    });
    request.on('error', reject);
  });
}

function authorizedControl(request) {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') && header.slice(7) === controlSecret;
}

function clearSession(socket) {
  if (!socket.mketyAccountRowId) return;
  const current = sessions.get(socket.mketyAccountRowId);
  if (current?.socket === socket) sessions.delete(socket.mketyAccountRowId);
}

const wsServer = new WebSocketServer({ port: wsPort, path: '/v1/cbot' });
wsServer.on('connection', (socket) => {
  socket.authenticated = false;

  const authTimer = setTimeout(() => {
    if (!socket.authenticated) socket.close(1008, 'AUTH_REQUIRED');
  }, 5000);

  socket.on('message', (data, isBinary) => {
    if (isBinary) return socket.close(1003, 'TEXT_ONLY');
    let message;
    try { message = JSON.parse(data.toString()); }
    catch { return socket.close(1007, 'INVALID_JSON'); }

    if (!socket.authenticated) {
      if (message?.type !== 'auth') return socket.close(1008, 'AUTH_REQUIRED');
      const verified = verifyConnectionToken(message.connectionToken, signingKey);
      if (!verified.ok) return socket.close(1008, verified.reason);
      const accountNumber = String(message.accountNumber ?? '').trim();
      if (!accountNumber) return socket.close(1008, 'ACCOUNT_ID_REQUIRED');

      clearTimeout(authTimer);
      socket.authenticated = true;
      socket.mketyAccountRowId = verified.accountRowId;
      socket.accountIdentity = {
        accountNumber,
        brokerName: String(message.brokerName ?? '').trim() || null,
        isLive: Boolean(message.isLive),
        instanceId: String(message.instanceId ?? '').trim() || null,
      };
      const previous = sessions.get(verified.accountRowId);
      if (previous?.socket?.readyState === WebSocket.OPEN && previous.socket !== socket) {
        previous.socket.close(1008, 'REPLACED_BY_NEW_SESSION');
      }
      sessions.set(verified.accountRowId, { socket, identity: socket.accountIdentity, connectedAt: Date.now(), lastHeartbeatAt: Date.now() });
      socket.send(JSON.stringify({ type: 'auth_ok', accountRowId: verified.accountRowId }));
      return;
    }

    const session = sessions.get(socket.mketyAccountRowId);
    if (message?.type === 'heartbeat') {
      if (session) session.lastHeartbeatAt = Date.now();
      socket.send(JSON.stringify({ type: 'heartbeat_ack', at: Date.now() }));
      return;
    }

    if (message?.type === 'result' && message.commandId) {
      const key = `${socket.mketyAccountRowId}:${message.commandId}`;
      const waiter = pending.get(key);
      if (!waiter) return;
      pending.delete(key);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });

  socket.on('close', () => {
    clearTimeout(authTimer);
    clearSession(socket);
  });
  socket.on('error', () => clearSession(socket));
});

const controlServer = http.createServer(async (request, response) => {
  if (!authorizedControl(request)) return json(response, 401, { ok: false, reason: 'CONTROL_AUTH_INVALID' });
  const url = new URL(request.url, 'http://localhost');

  const statusMatch = url.pathname.match(/^\/v1\/connections\/([^/]+)$/);
  if (request.method === 'GET' && statusMatch) {
    const accountRowId = decodeURIComponent(statusMatch[1]);
    const session = sessions.get(accountRowId);
    if (!session || session.socket.readyState !== WebSocket.OPEN) return json(response, 404, { ok: false, reason: 'CBOT_OFFLINE' });
    return json(response, 200, {
      ok: true,
      online: true,
      accountRowId,
      identity: session.identity,
      connectedAt: session.connectedAt,
      lastHeartbeatAt: session.lastHeartbeatAt,
    });
  }

  const commandMatch = url.pathname.match(/^\/v1\/commands\/([^/]+)$/);
  if (request.method === 'POST' && commandMatch) {
    const accountRowId = decodeURIComponent(commandMatch[1]);
    let envelope;
    try { envelope = await readJson(request); }
    catch (error) { return json(response, error.message === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, reason: error.message }); }

    const valid = validateCommand(envelope, accountRowId);
    if (!valid.ok) return json(response, 400, { ok: false, reason: valid.reason });
    const session = sessions.get(accountRowId);
    if (!session || session.socket.readyState !== WebSocket.OPEN) return json(response, 409, { ok: false, reason: 'CBOT_OFFLINE' });

    const key = `${accountRowId}:${envelope.command_id}`;
    if (pending.has(key)) return json(response, 409, { ok: false, reason: 'COMMAND_ALREADY_PENDING' });

    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error('CBOT_RESULT_TIMEOUT'));
        }, commandTimeoutMs);
        pending.set(key, { resolve, reject, timer });
        session.socket.send(JSON.stringify({ type: 'command', envelope }));
      });
      return json(response, result.ok === false ? 409 : 200, result);
    } catch (error) {
      return json(response, 504, { ok: false, reason: error.message || 'CBOT_RESULT_TIMEOUT' });
    }
  }

  return json(response, 404, { ok: false, reason: 'NOT_FOUND' });
});

controlServer.listen(controlPort, '0.0.0.0', () => {
  console.log(`cBot control API listening on ${controlPort}`);
});
console.log(`cBot WebSocket gateway listening on ${wsPort}`);

function shutdown() {
  for (const { socket } of sessions.values()) {
    try { socket.close(1001, 'SERVER_SHUTDOWN'); } catch {}
  }
  wsServer.close();
  controlServer.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
