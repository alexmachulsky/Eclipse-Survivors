import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { GameSim } from '../src/game/GameSim';
import type { PlayerCommand, PlayerRuntime } from '../src/game/types';

type ClientMessage =
  | { type: 'hello'; name?: string; reconnectToken?: string; roomCode?: string }
  | { type: 'start'; playerId: string }
  | { type: 'restart'; playerId: string }
  | ({ type: 'command' } & PlayerCommand)
  | { type: 'selectUpgrade'; playerId: string; upgradeId: string };

interface ClientConnection {
  socket: WebSocket;
  playerId: string;
  reconnectToken: string;
  lastCommandSeq: number;
  invalidMessages: number;
  commandWindowStartedAt: number;
  commandCount: number;
  controlWindowStartedAt: number;
  controlCount: number;
}

interface SessionRecord {
  playerId: string;
  disconnectedAt: number | null;
}

export interface LanServerOptions {
  allowedOrigins?: string[];
  roomCode?: string;
  disconnectGraceMs?: number;
  maxPayloadBytes?: number;
  heartbeatMs?: number;
}

export interface LanServerHandle {
  server: Server;
  listen: (port: number, host?: string) => Promise<void>;
  close: () => Promise<void>;
  cleanupDisconnectedPlayers: () => void;
}

const DEFAULT_PORT = Number(process.env.PORT ?? 3001);
const TICK_RATE = 60;
const SNAPSHOT_RATE = 20;
const MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const MAX_NAME_LENGTH = 24;

function sanitizeName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback;
  }

  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || fallback;
}

function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isAllowedOrigin(originHeader: string | undefined, hostHeader: string | undefined, allowedOrigins: string[]): boolean {
  if (!originHeader || !hostHeader) {
    return false;
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  const allowed = new Set(allowedOrigins);
  allowed.add(`http://${hostHeader}`);
  allowed.add(`https://${hostHeader}`);

  return allowed.has(origin.origin);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseMessage(raw: RawData): ClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return null;
  }

  if (!isObject(parsed) || !isString(parsed.type)) {
    return null;
  }

  if (parsed.type === 'hello') {
    if (parsed.name !== undefined && !isString(parsed.name)) return null;
    if (parsed.reconnectToken !== undefined && !isString(parsed.reconnectToken)) return null;
    if (parsed.roomCode !== undefined && !isString(parsed.roomCode)) return null;
    return parsed as ClientMessage;
  }

  if ((parsed.type === 'start' || parsed.type === 'restart') && isString(parsed.playerId)) {
    return parsed as ClientMessage;
  }

  if (parsed.type === 'selectUpgrade' && isString(parsed.playerId) && isString(parsed.upgradeId)) {
    return parsed as ClientMessage;
  }

  if (
    parsed.type === 'command' &&
    isString(parsed.playerId) &&
    isBoolean(parsed.moveUp) &&
    isBoolean(parsed.moveDown) &&
    isBoolean(parsed.moveLeft) &&
    isBoolean(parsed.moveRight) &&
    isFiniteNumber(parsed.aimWorldX) &&
    isFiniteNumber(parsed.aimWorldY) &&
    isBoolean(parsed.reviveHeld) &&
    (parsed.seq === undefined || isFiniteNumber(parsed.seq))
  ) {
    return parsed as ClientMessage;
  }

  return null;
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) {
    socket.send(JSON.stringify(payload));
  }
}

function consumeRate(client: ClientConnection, kind: 'command' | 'control'): boolean {
  const now = Date.now();
  const limit = kind === 'command' ? 120 : 16;
  const windowMs = 1000;

  if (kind === 'command') {
    if (now - client.commandWindowStartedAt >= windowMs) {
      client.commandWindowStartedAt = now;
      client.commandCount = 0;
    }
    client.commandCount += 1;
    return client.commandCount <= limit;
  }

  if (now - client.controlWindowStartedAt >= windowMs) {
    client.controlWindowStartedAt = now;
    client.controlCount = 0;
  }
  client.controlCount += 1;
  return client.controlCount <= limit;
}

export function createLanServer(options: LanServerOptions = {}): LanServerHandle {
  const allowedOrigins = options.allowedOrigins ?? parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  const roomCode = options.roomCode ?? process.env.LAN_ROOM_CODE;
  const disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const sim = new GameSim();
  const clients = new Map<WebSocket, ClientConnection>();
  const sessions = new Map<string, SessionRecord>();
  const activeSessions = new Map<string, WebSocket>();
  let hostPlayerId: string | null = null;
  let lastTick = Date.now();
  let snapshotAccumulator = 0;

  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }

    response.writeHead(404);
    response.end();
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false
  });

  function currentRoomPhase() {
    const phase = sim.getState().phase;
    if (phase === 'menu') return 'lobby';
    if (phase === 'victory') return 'victory';
    if (phase === 'gameOver') return 'gameOver';
    return 'playing';
  }

  function publicSnapshotFor(playerId: string) {
    return {
      type: 'snapshot',
      tick: Math.floor(sim.getState().elapsed * TICK_RATE),
      localPlayerId: playerId,
      room: {
        phase: currentRoomPhase(),
        hostPlayerId
      },
      state: sim.getState()
    };
  }

  function broadcastSnapshots(): void {
    for (const client of clients.values()) {
      send(client.socket, publicSnapshotFor(client.playerId));
    }
  }

  function updateHost(): void {
    const host = hostPlayerId ? sim.getState().players.find((player) => player.id === hostPlayerId) : undefined;
    if (!host || host.status === 'disconnected') {
      hostPlayerId = sim.getState().players.find((runtime) => runtime.status !== 'disconnected')?.id ?? null;
    }
  }

  function claimPlayer(name: string, reconnectToken: string | undefined): { player: PlayerRuntime; reconnectToken: string } {
    const existingRecord = reconnectToken ? sessions.get(reconnectToken) : undefined;
    const existing = existingRecord ? sim.getState().players.find((player) => player.id === existingRecord.playerId) : undefined;

    if (existing && existingRecord && reconnectToken) {
      sim.markConnected(existing.id);
      existing.name = sanitizeName(name, existing.name);
      existingRecord.disconnectedAt = null;
      updateHost();
      return { player: existing, reconnectToken };
    }

    const token = randomUUID();
    const player = sim.addPlayer(sanitizeName(name, `Player ${sim.getState().players.length + 1}`));
    sessions.set(token, { playerId: player.id, disconnectedAt: null });

    if (!hostPlayerId) {
      hostPlayerId = player.id;
    }

    return { player, reconnectToken: token };
  }

  function closeInvalid(socket: WebSocket, client?: ClientConnection): void {
    if (client) {
      client.invalidMessages += 1;
    }
    socket.close(1003, 'invalid message');
  }

  function handleReadyMessage(client: ClientConnection, message: ClientMessage): void {
    if (message.type === 'command') {
      if (!consumeRate(client, 'command')) {
        client.socket.close(1013, 'rate limited');
        return;
      }

      if (message.playerId === client.playerId) {
        const seq = message.seq ?? client.lastCommandSeq + 1;
        if (seq <= client.lastCommandSeq) {
          return;
        }
        client.lastCommandSeq = seq;
        sim.applyCommand({ ...message, seq });
      }
      return;
    }

    if (!consumeRate(client, 'control')) {
      client.socket.close(1013, 'rate limited');
      return;
    }

    if (message.type === 'selectUpgrade') {
      if (message.playerId === client.playerId) {
        sim.selectUpgrade(client.playerId, message.upgradeId);
        broadcastSnapshots();
      }
      return;
    }

    if (message.type === 'start' || message.type === 'restart') {
      if (client.playerId === hostPlayerId) {
        sim.startRun();
        broadcastSnapshots();
      }
    }
  }

  function handleHello(socket: WebSocket, raw: RawData, helloTimer: ReturnType<typeof setTimeout>): void {
    const message = parseMessage(raw);
    if (!message || message.type !== 'hello') {
      closeInvalid(socket);
      return;
    }

    if (roomCode && message.roomCode !== roomCode) {
      socket.close(1008, 'invalid room');
      return;
    }

    clearTimeout(helloTimer);
    let claimed: { player: PlayerRuntime; reconnectToken: string };
    try {
      claimed = claimPlayer(message.name ?? '', message.reconnectToken);
    } catch (error) {
      send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Unable to join room' });
      socket.close(1013, 'room full');
      return;
    }
    const previousSocket = activeSessions.get(claimed.reconnectToken);

    if (previousSocket && previousSocket !== socket) {
      previousSocket.close(4001, 'session replaced');
    }

    activeSessions.set(claimed.reconnectToken, socket);
    const now = Date.now();
    const client: ClientConnection = {
      socket,
      playerId: claimed.player.id,
      reconnectToken: claimed.reconnectToken,
      lastCommandSeq: -1,
      invalidMessages: 0,
      commandWindowStartedAt: now,
      commandCount: 0,
      controlWindowStartedAt: now,
      controlCount: 0
    };
    clients.set(socket, client);

    send(socket, { type: 'welcome', playerId: claimed.player.id, reconnectToken: claimed.reconnectToken });
    send(socket, publicSnapshotFor(claimed.player.id));
    broadcastSnapshots();

    socket.removeAllListeners('message');
    socket.on('message', (nextRaw) => {
      const nextMessage = parseMessage(nextRaw);
      if (!nextMessage || nextMessage.type === 'hello') {
        closeInvalid(socket, client);
        return;
      }
      handleReadyMessage(client, nextMessage);
    });
  }

  function cleanupDisconnectedPlayers(): void {
    const now = Date.now();

    for (const [token, session] of sessions) {
      if (session.disconnectedAt === null || now - session.disconnectedAt < disconnectGraceMs) {
        continue;
      }

      sim.removePlayer(session.playerId);
      sessions.delete(token);
      if (hostPlayerId === session.playerId) {
        hostPlayerId = null;
      }
    }

    updateHost();
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/ws' || !isAllowedOrigin(request.headers.origin, request.headers.host, allowedOrigins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket) => {
    const helloTimer = setTimeout(() => socket.close(1008, 'hello required'), 5000);

    socket.on('message', (raw) => handleHello(socket, raw, helloTimer));
    socket.on('close', () => {
      clearTimeout(helloTimer);
      const client = clients.get(socket);
      if (!client) {
        return;
      }

      clients.delete(socket);
      if (activeSessions.get(client.reconnectToken) !== socket) {
        return;
      }

      activeSessions.delete(client.reconnectToken);
      sim.markDisconnected(client.playerId);
      const session = sessions.get(client.reconnectToken);
      if (session) {
        session.disconnectedAt = Date.now();
      }
      updateHost();
      broadcastSnapshots();
    });
    socket.on('error', () => undefined);
  });

  const tickTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    sim.update(dt);
    snapshotAccumulator += dt;

    if (snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
      snapshotAccumulator = 0;
      broadcastSnapshots();
    }
  }, 1000 / TICK_RATE);

  const cleanupTimer = setInterval(cleanupDisconnectedPlayers, Math.min(disconnectGraceMs, 10_000));
  const heartbeatTimer = setInterval(() => {
    for (const client of clients.values()) {
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.ping();
      }
    }
  }, heartbeatMs);

  return {
    server,
    listen: (port, host = '0.0.0.0') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(tickTimer);
      clearInterval(cleanupTimer);
      clearInterval(heartbeatTimer);
      for (const socket of wss.clients) {
        socket.close();
      }
      wss.close(() => {
        server.close(() => resolve());
      });
    }),
    cleanupDisconnectedPlayers
  };
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const handle = createLanServer();
  handle.listen(DEFAULT_PORT).then(() => {
    console.log(`LAN multiplayer server listening on ${DEFAULT_PORT}`);
  }).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
