import { createServer, type Server } from 'node:http';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { GameSim } from '../src/game/GameSim';
import type { PlayerCommand, PlayerRuntime } from '../src/game/types';

type HelloAction = 'create' | 'join';

type ClientMessage =
  | { type: 'hello'; name?: string; reconnectToken?: string; roomCode?: string; action?: HelloAction; roomName?: string }
  | { type: 'start'; playerId: string }
  | { type: 'restart'; playerId: string }
  | ({ type: 'command' } & PlayerCommand)
  | { type: 'selectUpgrade'; playerId: string; upgradeId: string };

interface ClientConnection {
  socket: WebSocket;
  playerId: string;
  reconnectToken: string;
  roomCode: string;
  lastCommandSeq: number;
  invalidMessages: number;
  commandWindowStartedAt: number;
  commandCount: number;
  controlWindowStartedAt: number;
  controlCount: number;
}

interface SessionRecord {
  playerId: string;
  roomCode: string;
  disconnectedAt: number | null;
}

interface Room {
  code: string;
  name: string;
  sim: GameSim;
  hostPlayerId: string | null;
  sessions: Map<string, SessionRecord>;
  activeSessions: Map<string, WebSocket>;
  createdAt: number;
  lastActivityAt: number;
}

export interface LanServerOptions {
  allowedOrigins?: string[];
  /**
   * Legacy single-room access code. When set, every hello must include this
   * matching `roomCode` value to be admitted. Multi-room creation/join is
   * disabled in this mode (used by the existing security tests).
   */
  roomCode?: string;
  disconnectGraceMs?: number;
  maxPayloadBytes?: number;
  heartbeatMs?: number;
  /** Empty rooms are removed after this many ms with no connected players. */
  emptyRoomTtlMs?: number;
  /** Maximum number of rooms kept in memory at once. */
  maxRooms?: number;
  /** Maximum number of fully joined websocket clients at once. */
  maxClients?: number;
  /** Per-remote-address room creations allowed per creation window. */
  maxRoomCreationsPerWindow?: number;
  /** Window for per-remote-address room creation throttling. */
  roomCreationWindowMs?: number;
}

export interface LanServerHandle {
  server: Server;
  listen: (port: number, host?: string) => Promise<void>;
  close: () => Promise<void>;
  cleanupDisconnectedPlayers: () => void;
}

const DEFAULT_PORT = Number(process.env.PORT ?? 3001);
const TICK_RATE = 60;
const SNAPSHOT_RATE = 30;
const MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_DISCONNECT_GRACE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_EMPTY_ROOM_TTL_MS = 60_000;
const DEFAULT_MAX_ROOMS = 32;
const DEFAULT_MAX_CLIENTS = 128;
const DEFAULT_MAX_ROOM_CREATIONS_PER_WINDOW = 8;
const DEFAULT_ROOM_CREATION_WINDOW_MS = 60_000;
const MAX_NAME_LENGTH = 24;
const MAX_ROOM_NAME_LENGTH = 32;
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omits I, O, 0, 1
const DEFAULT_ROOM_CODE = 'LOBBY';

function sanitizeName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback;
  }

  const cleaned = name.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || fallback;
}

function sanitizeRoomName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback;
  }

  const cleaned = name.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_ROOM_NAME_LENGTH) || fallback;
}

function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!trimmed) return null;
  return trimmed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function generateRoomCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!taken(code)) return code;
  }
  // Fallback with longer code if 4-char space is exhausted (extremely unlikely).
  return randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin));
}

function normalizeOrigin(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');

  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number(part));

  if (!octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isLocalNetworkHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized === 'localhost' || isPrivateIpv4(normalized)) {
    return true;
  }

  if (!normalized.includes(':')) {
    return false;
  }

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

export function isAllowedOrigin(originHeader: string | undefined, allowedOrigins: string[]): boolean {
  if (!originHeader) {
    return false;
  }

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return false;
  }

  if (allowedOrigins.includes(origin.origin)) {
    return true;
  }

  return (origin.protocol === 'http:' || origin.protocol === 'https:') && isLocalNetworkHostname(origin.hostname);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
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
    if (parsed.roomName !== undefined && !isString(parsed.roomName)) return null;
    if (parsed.action !== undefined && parsed.action !== 'create' && parsed.action !== 'join') return null;
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
  const legacyRoomCode = options.roomCode ?? process.env.LAN_ROOM_CODE;
  const disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const emptyRoomTtlMs = options.emptyRoomTtlMs ?? DEFAULT_EMPTY_ROOM_TTL_MS;
  const maxRooms = options.maxRooms ?? parsePositiveInteger(process.env.LAN_MAX_ROOMS, DEFAULT_MAX_ROOMS);
  const maxClients = options.maxClients ?? parsePositiveInteger(process.env.LAN_MAX_CLIENTS, DEFAULT_MAX_CLIENTS);
  const maxRoomCreationsPerWindow = options.maxRoomCreationsPerWindow
    ?? parsePositiveInteger(process.env.LAN_MAX_ROOM_CREATIONS_PER_WINDOW, DEFAULT_MAX_ROOM_CREATIONS_PER_WINDOW);
  const roomCreationWindowMs = options.roomCreationWindowMs
    ?? parsePositiveInteger(process.env.LAN_ROOM_CREATION_WINDOW_MS, DEFAULT_ROOM_CREATION_WINDOW_MS);

  const rooms = new Map<string, Room>();
  const clients = new Map<WebSocket, ClientConnection>();
  const roomCreationWindows = new Map<string, { startedAt: number; count: number }>();
  let lastTick = Date.now();
  let snapshotAccumulator = 0;

  function reject(socket: WebSocket, message: string, code = 1013): void {
    send(socket, { type: 'error', message });
    socket.close(code, message.slice(0, 120));
  }

  function canCreateRoom(): boolean {
    return rooms.size < maxRooms;
  }

  function consumeRoomCreation(remoteAddress: string): boolean {
    const now = Date.now();
    const current = roomCreationWindows.get(remoteAddress);

    if (!current || now - current.startedAt >= roomCreationWindowMs) {
      roomCreationWindows.set(remoteAddress, { startedAt: now, count: 1 });
      return true;
    }

    current.count += 1;
    return current.count <= maxRoomCreationsPerWindow;
  }

  function createRoom(code: string, name: string): Room {
    const room: Room = {
      code,
      name,
      sim: new GameSim(),
      hostPlayerId: null,
      sessions: new Map(),
      activeSessions: new Map(),
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    rooms.set(code, room);
    return room;
  }

  function maybeCreateRoom(socket: WebSocket, code: string, name: string, remoteAddress: string): Room | null {
    if (!canCreateRoom()) {
      reject(socket, 'Room limit reached. Try again after an empty room closes.');
      return null;
    }

    if (!consumeRoomCreation(remoteAddress)) {
      reject(socket, 'Too many rooms created from this address. Try again later.');
      return null;
    }

    return createRoom(code, name);
  }

  function ensureDefaultRoom(socket: WebSocket, remoteAddress: string): Room | null {
    return rooms.get(DEFAULT_ROOM_CODE) ?? maybeCreateRoom(socket, DEFAULT_ROOM_CODE, 'Open Lobby', remoteAddress);
  }

  function roomHasConnectedClient(room: Room): boolean {
    for (const client of clients.values()) {
      if (client.roomCode === room.code) return true;
    }
    return false;
  }

  function deleteRoom(room: Room): void {
    for (const socket of room.activeSessions.values()) {
      socket.close(4002, 'room closed');
    }
    rooms.delete(room.code);
  }

  function currentRoomPhase(room: Room): 'lobby' | 'playing' | 'gameOver' | 'victory' {
    const phase = room.sim.getState().phase;
    if (phase === 'menu') return 'lobby';
    if (phase === 'victory') return 'victory';
    if (phase === 'gameOver') return 'gameOver';
    return 'playing';
  }

  function publicSnapshotFor(room: Room, playerId: string) {
    const s = room.sim.getState();
    return {
      type: 'snapshot' as const,
      tick: Math.floor(s.elapsed * TICK_RATE),
      localPlayerId: playerId,
      room: {
        code: room.code,
        name: room.name,
        phase: currentRoomPhase(room),
        hostPlayerId: room.hostPlayerId
      },
      // Particles and damage texts are purely cosmetic — generated locally on
      // each client. Stripping them cuts snapshot payload by 50-90%.
      state: { ...s, particles: [], damageTexts: [] }
    };
  }

  function broadcastSnapshots(room: Room): void {
    for (const client of clients.values()) {
      if (client.roomCode !== room.code) continue;
      send(client.socket, publicSnapshotFor(room, client.playerId));
    }
  }

  function updateHost(room: Room): void {
    const host = room.hostPlayerId ? room.sim.getState().players.find((player) => player.id === room.hostPlayerId) : undefined;
    if (!host || host.status === 'disconnected') {
      room.hostPlayerId = room.sim.getState().players.find((runtime) => runtime.status !== 'disconnected')?.id ?? null;
    }
  }

  function claimPlayer(
    room: Room,
    name: string,
    reconnectToken: string | undefined
  ): { player: PlayerRuntime; reconnectToken: string } {
    const existingRecord = reconnectToken ? room.sessions.get(reconnectToken) : undefined;
    const existing = existingRecord ? room.sim.getState().players.find((player) => player.id === existingRecord.playerId) : undefined;

    if (existing && existingRecord && reconnectToken) {
      room.sim.markConnected(existing.id);
      existing.name = sanitizeName(name, existing.name);
      existingRecord.disconnectedAt = null;
      updateHost(room);
      return { player: existing, reconnectToken };
    }

    const token = randomUUID();
    const player = room.sim.addPlayer(sanitizeName(name, `Player ${room.sim.getState().players.length + 1}`));
    room.sessions.set(token, { playerId: player.id, roomCode: room.code, disconnectedAt: null });

    if (!room.hostPlayerId) {
      room.hostPlayerId = player.id;
    }

    return { player, reconnectToken: token };
  }

  function hasActiveSession(reconnectToken: string | undefined): boolean {
    if (!reconnectToken) {
      return false;
    }

    for (const room of rooms.values()) {
      if (room.activeSessions.has(reconnectToken)) {
        return true;
      }
    }

    return false;
  }

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

  function closeInvalid(socket: WebSocket, client?: ClientConnection): void {
    if (client) {
      client.invalidMessages += 1;
    }
    socket.close(1003, 'invalid message');
  }

  function handleReadyMessage(client: ClientConnection, message: ClientMessage): void {
    const room = rooms.get(client.roomCode);
    if (!room) {
      client.socket.close(4002, 'room closed');
      return;
    }

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
        room.sim.applyCommand({ ...message, seq });
        room.lastActivityAt = Date.now();
      }
      return;
    }

    if (!consumeRate(client, 'control')) {
      client.socket.close(1013, 'rate limited');
      return;
    }

    if (message.type === 'selectUpgrade') {
      if (message.playerId === client.playerId) {
        room.sim.selectUpgrade(client.playerId, message.upgradeId);
        room.lastActivityAt = Date.now();
        broadcastSnapshots(room);
      }
      return;
    }

    if (message.type === 'start' || message.type === 'restart') {
      if (client.playerId === room.hostPlayerId) {
        room.sim.startRun();
        room.lastActivityAt = Date.now();
        broadcastSnapshots(room);
      }
    }
  }

  function resolveRoomForHello(socket: WebSocket, message: Extract<ClientMessage, { type: 'hello' }>, remoteAddress: string): Room | null {
    // Legacy single-room mode: every hello must match the configured roomCode,
    // and multi-room creation/join is disabled.
    if (legacyRoomCode) {
      if (message.roomCode !== legacyRoomCode && message.action) {
        socket.close(1008, 'invalid room');
        return null;
      }
      if (message.roomCode && message.roomCode !== legacyRoomCode) {
        socket.close(1008, 'invalid room');
        return null;
      }
      return ensureDefaultRoom(socket, remoteAddress);
    }

    // Reconnect path: use the room from the saved session, but only when the
    // client did NOT request an explicit create/join action. An explicit
    // action always wins so users can deliberately switch rooms.
    if (message.reconnectToken && !message.action) {
      for (const room of rooms.values()) {
        if (room.sessions.has(message.reconnectToken)) {
          return room;
        }
      }
    }

    if (message.action === 'create') {
      const code = generateRoomCode((candidate) => rooms.has(candidate));
      return maybeCreateRoom(socket, code, sanitizeRoomName(message.roomName, "Friend's Room"), remoteAddress);
    }

    if (message.action === 'join') {
      const code = normalizeRoomCode(message.roomCode);
      if (!code) {
        send(socket, { type: 'error', message: 'A room code is required to join.' });
        socket.close(1008, 'missing room code');
        return null;
      }
      const room = rooms.get(code);
      if (!room) {
        send(socket, { type: 'error', message: 'Room not found. Double-check the code with the host.' });
        socket.close(1008, 'room not found');
        return null;
      }
      return room;
    }

    // Backward-compatible default: shared "Open Lobby" room when the client
    // sends no action (used by the existing security tests).
    if (message.roomCode) {
      const code = normalizeRoomCode(message.roomCode);
      if (code) {
        return rooms.get(code) ?? maybeCreateRoom(socket, code, "Friend's Room", remoteAddress);
      }
    }
    return ensureDefaultRoom(socket, remoteAddress);
  }

  function handleHello(socket: WebSocket, raw: RawData, helloTimer: ReturnType<typeof setTimeout>, remoteAddress: string): void {
    const message = parseMessage(raw);
    if (!message || message.type !== 'hello') {
      closeInvalid(socket);
      return;
    }

    clearTimeout(helloTimer);

    // For an explicit create/join, ignore any stale reconnect token so the
    // user gets a fresh seat in the chosen room.
    const effectiveReconnect = message.action ? undefined : message.reconnectToken;
    if (clients.size >= maxClients && !hasActiveSession(effectiveReconnect)) {
      reject(socket, 'Server is full. Try again after a player leaves.');
      return;
    }

    const room = resolveRoomForHello(socket, message, remoteAddress);
    if (!room) {
      return;
    }

    let claimed: { player: PlayerRuntime; reconnectToken: string };
    try {
      claimed = claimPlayer(room, message.name ?? '', effectiveReconnect);
    } catch (error) {
      send(socket, { type: 'error', message: error instanceof Error ? error.message : 'Unable to join room' });
      socket.close(1013, 'room full');
      return;
    }
    const previousSocket = room.activeSessions.get(claimed.reconnectToken);

    if (previousSocket && previousSocket !== socket) {
      previousSocket.close(4001, 'session replaced');
    }

    room.activeSessions.set(claimed.reconnectToken, socket);
    room.lastActivityAt = Date.now();
    const now = Date.now();
    const client: ClientConnection = {
      socket,
      playerId: claimed.player.id,
      reconnectToken: claimed.reconnectToken,
      roomCode: room.code,
      lastCommandSeq: -1,
      invalidMessages: 0,
      commandWindowStartedAt: now,
      commandCount: 0,
      controlWindowStartedAt: now,
      controlCount: 0
    };
    clients.set(socket, client);

    send(socket, {
      type: 'welcome',
      playerId: claimed.player.id,
      reconnectToken: claimed.reconnectToken,
      roomCode: room.code,
      roomName: room.name
    });
    send(socket, publicSnapshotFor(room, claimed.player.id));
    broadcastSnapshots(room);

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

    for (const room of rooms.values()) {
      for (const [token, session] of room.sessions) {
        if (session.disconnectedAt === null || now - session.disconnectedAt < disconnectGraceMs) {
          continue;
        }

        room.sim.removePlayer(session.playerId);
        room.sessions.delete(token);
        if (room.hostPlayerId === session.playerId) {
          room.hostPlayerId = null;
        }
      }

      updateHost(room);
    }

    // Drop empty rooms (no players, no connected clients) after their TTL.
    for (const room of rooms.values()) {
      if (room.code === DEFAULT_ROOM_CODE) continue;
      if (room.sim.getState().players.length > 0) continue;
      if (roomHasConnectedClient(room)) continue;
      if (now - room.lastActivityAt < emptyRoomTtlMs) continue;
      deleteRoom(room);
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/ws' || !isAllowedOrigin(request.headers.origin, allowedOrigins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket, request) => {
    const helloTimer = setTimeout(() => socket.close(1008, 'hello required'), 5000);
    const remoteAddress = request.socket.remoteAddress ?? 'unknown';

    socket.on('message', (raw) => handleHello(socket, raw, helloTimer, remoteAddress));
    socket.on('close', () => {
      clearTimeout(helloTimer);
      const client = clients.get(socket);
      if (!client) {
        return;
      }

      clients.delete(socket);
      const room = rooms.get(client.roomCode);
      if (!room) {
        return;
      }
      if (room.activeSessions.get(client.reconnectToken) !== socket) {
        return;
      }

      room.activeSessions.delete(client.reconnectToken);
      room.sim.markDisconnected(client.playerId);
      const session = room.sessions.get(client.reconnectToken);
      if (session) {
        session.disconnectedAt = Date.now();
      }
      updateHost(room);
      broadcastSnapshots(room);
    });
    socket.on('error', () => undefined);
  });

  const tickTimer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;

    for (const room of rooms.values()) {
      room.sim.update(dt);
    }

    snapshotAccumulator += dt;

    if (snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
      snapshotAccumulator = 0;
      for (const room of rooms.values()) {
        broadcastSnapshots(room);
      }
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
