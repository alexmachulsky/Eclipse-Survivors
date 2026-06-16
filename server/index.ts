import { createServer, type Server, type IncomingMessage } from 'node:http';
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
  commandWindowStartedAt: number;
  commandCount: number;
  controlWindowStartedAt: number;
  controlCount: number;
  /** Liveness flag for the ping/pong heartbeat; reset to false on each ping. */
  isAlive: boolean;
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
  /** Max simultaneous pre-hello (unauthenticated) connections per client IP. */
  maxPendingConnectionsPerIp?: number;
  /** Hard cap on simultaneous pre-hello connections across ALL IPs (DoS backstop). */
  maxPendingConnectionsTotal?: number;
  /**
   * When true (the LAN-party default), genuine local-network browser origins
   * are admitted even if not in `allowedOrigins`. Set false (ALLOW_LAN_ORIGINS=
   * false) to enforce an explicit allowlist and refuse the local-network
   * fallback.
   */
  allowLocalNetworkOrigins?: boolean;
  /**
   * Trust proxy forwarding headers (X-Real-IP / X-Forwarded-For) for per-IP
   * throttling. Only safe behind a trusted reverse proxy that sets them. When
   * false (default), the raw socket address is used so a directly-exposed
   * server cannot be tricked into per-IP spoofing. Docker runs behind nginx and
   * sets TRUST_PROXY=true.
   */
  trustProxyHeaders?: boolean;
  /** Per-address failed room-join attempts allowed per window (anti brute-force). */
  maxFailedJoinsPerWindow?: number;
  /** Window for per-address failed-join throttling. */
  failedJoinWindowMs?: number;
}

export interface LanServerHandle {
  server: Server;
  listen: (port: number, host?: string) => Promise<void>;
  close: () => Promise<void>;
  cleanupDisconnectedPlayers: () => void;
  /** Internal counters for tests/observability (room + connection bookkeeping). */
  getStats: () => { rooms: number; clients: number; roomCreationWindows: number; pendingConnections: number };
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
const DEFAULT_MAX_PENDING_PER_IP = 16;
const DEFAULT_MAX_PENDING_TOTAL = 256;
const DEFAULT_MAX_FAILED_JOINS_PER_WINDOW = 10;
const DEFAULT_FAILED_JOIN_WINDOW_MS = 60_000;
const MAX_NAME_LENGTH = 24;
const MAX_ROOM_CODE_LENGTH = 16;
const MAX_ROOM_NAME_LENGTH = 32;
const ROOM_CODE_LENGTH = 6; // 6 × 32-symbol alphabet ≈ 30 bits (was 4 ≈ 20 bits)
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omits I, O, 0, 1
const DEFAULT_ROOM_CODE = 'LOBBY';

function sanitizeName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback;
  }

  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || fallback;
}

function sanitizeRoomName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback;
  }

  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_ROOM_NAME_LENGTH) || fallback;
}

function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Cap length before the regex so a multi-KB roomCode can't waste CPU or become
  // a giant Map key. A real code is ROOM_CODE_LENGTH chars; the cap is generous.
  const trimmed = value.slice(0, MAX_ROOM_CODE_LENGTH * 4).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_ROOM_CODE_LENGTH);
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

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
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

export function isAllowedOrigin(
  originHeader: string | undefined,
  allowedOrigins: string[],
  allowLocalNetwork = true
): boolean {
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

  // Local-network fallback for the LAN-party default. Opt-out (allowLocalNetwork
  // = false) so an operator's explicit allowlist is never silently re-widened to
  // every loopback/RFC1918/link-local origin.
  if (!allowLocalNetwork) {
    return false;
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

/**
 * Resolve the client IP used for per-IP throttling.
 *
 * Behind the nginx reverse proxy (the docker deployment's only public entry
 * point) the raw socket address is the proxy's, so per-IP throttling collapses
 * to a single bucket unless we read the proxy-set X-Real-IP / X-Forwarded-For
 * headers. But those headers are client-settable, so trusting them on a
 * directly-exposed server lets an attacker forge a fresh IP per request and
 * sail past every per-IP cap. We therefore only honor them when explicitly told
 * we sit behind a trusted proxy (TRUST_PROXY=true); otherwise we use the
 * unspoofable socket address.
 */
function getClientIp(request: IncomingMessage, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const realIp = request.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim()) {
      return realIp.trim();
    }

    const forwarded = request.headers['x-forwarded-for'];
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (typeof forwardedValue === 'string' && forwardedValue.trim()) {
      return forwardedValue.split(',')[0].trim();
    }
  }

  return request.socket.remoteAddress ?? 'unknown';
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
    isBoolean(parsed.dashHeld) &&
    // seq must be a non-negative safe integer. Rejecting fractional/negative/
    // absurd values (e.g. 1e308) keeps a client from pinning its own
    // lastCommandSeq sky-high and locking out all of its future commands.
    (parsed.seq === undefined
      || (isFiniteNumber(parsed.seq) && Number.isInteger(parsed.seq) && parsed.seq >= 0 && parsed.seq <= Number.MAX_SAFE_INTEGER))
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
  const maxPendingConnectionsPerIp = options.maxPendingConnectionsPerIp
    ?? parsePositiveInteger(process.env.LAN_MAX_PENDING_PER_IP, DEFAULT_MAX_PENDING_PER_IP);
  const maxPendingConnectionsTotal = options.maxPendingConnectionsTotal
    ?? parsePositiveInteger(process.env.LAN_MAX_PENDING_TOTAL, DEFAULT_MAX_PENDING_TOTAL);
  const allowLocalNetworkOrigins = options.allowLocalNetworkOrigins
    ?? parseBooleanEnv(process.env.ALLOW_LAN_ORIGINS, true);
  const trustProxyHeaders = options.trustProxyHeaders
    ?? parseBooleanEnv(process.env.TRUST_PROXY, false);
  const maxFailedJoinsPerWindow = options.maxFailedJoinsPerWindow
    ?? parsePositiveInteger(process.env.LAN_MAX_FAILED_JOINS_PER_WINDOW, DEFAULT_MAX_FAILED_JOINS_PER_WINDOW);
  const failedJoinWindowMs = options.failedJoinWindowMs
    ?? parsePositiveInteger(process.env.LAN_FAILED_JOIN_WINDOW_MS, DEFAULT_FAILED_JOIN_WINDOW_MS);

  if (process.env.ALLOWED_ORIGINS && allowedOrigins.length === 0 && allowLocalNetworkOrigins) {
    console.warn(
      '[lan-server] ALLOWED_ORIGINS is set but produced an empty allowlist; only local-network origins will be admitted.'
    );
  }

  const rooms = new Map<string, Room>();
  const clients = new Map<WebSocket, ClientConnection>();
  const roomCreationWindows = new Map<string, { startedAt: number; count: number }>();
  const failedJoinWindows = new Map<string, { startedAt: number; count: number }>();
  const pendingByIp = new Map<string, number>();
  let pendingTotal = 0;
  let lastTick = Date.now();
  let snapshotAccumulator = 0;

  // Throttle repeated failed room joins from one address so the ~30-bit room-code
  // space can't be brute-forced by cycling connections. Returns false once the
  // per-window budget is spent. Counts only *misses* — a correct code never
  // increments — so legitimate players are unaffected.
  function consumeFailedJoin(remoteAddress: string): boolean {
    const now = Date.now();
    const current = failedJoinWindows.get(remoteAddress);
    if (!current || now - current.startedAt >= failedJoinWindowMs) {
      failedJoinWindows.set(remoteAddress, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= maxFailedJoinsPerWindow;
  }

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
  ): { player: PlayerRuntime; reconnectToken: string; previousToken?: string } {
    const existingRecord = reconnectToken ? room.sessions.get(reconnectToken) : undefined;
    const existing = existingRecord ? room.sim.getState().players.find((player) => player.id === existingRecord.playerId) : undefined;

    if (existing && existingRecord && reconnectToken) {
      room.sim.markConnected(existing.id);
      existing.name = sanitizeName(name, existing.name);
      existingRecord.disconnectedAt = null;
      // SECURITY: rotate the reconnect token on every successful reconnect. The
      // token is a bearer credential delivered in the cleartext `welcome`, so a
      // captured copy is replayable. Rotation invalidates the old token the
      // moment the legitimate owner reconnects once, shrinking the replay window
      // (use wss:// across untrusted networks for full confidentiality).
      const rotatedToken = randomUUID();
      room.sessions.delete(reconnectToken);
      room.sessions.set(rotatedToken, existingRecord);
      updateHost(room);
      return { player: existing, reconnectToken: rotatedToken, previousToken: reconnectToken };
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

  function closeInvalid(socket: WebSocket): void {
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
      // SECURITY: require the access code on EVERY hello, including ones that
      // omit roomCode entirely. The previous two-guard form only rejected a
      // *wrong* code; a hello with no roomCode and no action slipped past both
      // guards and fell through to ensureDefaultRoom, bypassing the gate. Match
      // normalizeRoomCode semantics so the comparison is case/format-insensitive.
      if (normalizeRoomCode(message.roomCode) !== normalizeRoomCode(legacyRoomCode)) {
        send(socket, { type: 'error', message: 'A valid room code is required.' });
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
        // SECURITY: throttle repeated misses per address so the ~30-bit room-code
        // space can't be brute-forced by cycling join attempts. A correct guess
        // never increments the counter, so honest players are never throttled.
        if (!consumeFailedJoin(remoteAddress)) {
          send(socket, { type: 'error', message: 'Too many failed join attempts. Try again later.' });
          socket.close(1013, 'join throttled');
          return null;
        }
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
    // A message arrived, so the hello deadline no longer applies. Clear the
    // timer up-front — before any accept/reject path — so it can never fire
    // later and call close() again on an already-rejected/closed socket.
    clearTimeout(helloTimer);

    const message = parseMessage(raw);
    if (!message || message.type !== 'hello') {
      closeInvalid(socket);
      return;
    }

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

    let claimed: { player: PlayerRuntime; reconnectToken: string; previousToken?: string };
    try {
      claimed = claimPlayer(room, message.name ?? '', effectiveReconnect);
    } catch (error) {
      // Log details server-side; send the client a generic message so internal
      // error text / stack details are never exposed to untrusted connections.
      console.error('[lan-server] claimPlayer failed:', error);
      send(socket, { type: 'error', message: 'Unable to join room.' });
      socket.close(1013, 'room full');
      return;
    }

    // A reconnect rotates the token, so the prior live socket (if any) is keyed
    // under the OLD token. Close it and drop the stale mapping before installing
    // the new one, so activeSessions never retains the pre-rotation key.
    const priorKey = claimed.previousToken ?? claimed.reconnectToken;
    const previousSocket = room.activeSessions.get(priorKey);
    if (previousSocket && previousSocket !== socket) {
      previousSocket.close(4001, 'session replaced');
    }
    if (claimed.previousToken) {
      room.activeSessions.delete(claimed.previousToken);
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
      commandWindowStartedAt: now,
      commandCount: 0,
      controlWindowStartedAt: now,
      controlCount: 0,
      isAlive: true
    };
    clients.set(socket, client);
    socket.on('pong', () => {
      client.isAlive = true;
    });

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
        closeInvalid(socket);
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

    // Prune expired per-IP throttle windows. Without this, the maps grow
    // unbounded — one lingering entry per unique IP that ever hit the limiter.
    for (const [ip, window] of roomCreationWindows) {
      if (now - window.startedAt >= roomCreationWindowMs) {
        roomCreationWindows.delete(ip);
      }
    }
    for (const [ip, window] of failedJoinWindows) {
      if (now - window.startedAt >= failedJoinWindowMs) {
        failedJoinWindows.delete(ip);
      }
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/ws' || !isAllowedOrigin(request.headers.origin, allowedOrigins, allowLocalNetworkOrigins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (socket, request) => {
    const remoteAddress = getClientIp(request, trustProxyHeaders);

    // Cap simultaneous unauthenticated (pre-hello) connections per IP. The
    // global maxClients limit only counts fully joined clients, so without this
    // an attacker could exhaust file descriptors/memory by opening many sockets
    // and never sending a hello (Slowloris-style).
    //
    // The per-IP cap is the first line of defense, but if proxy-header trust is
    // disabled (or many IPs are involved) it can't bound the absolute socket
    // count, so a global pre-hello ceiling backstops it.
    const pending = pendingByIp.get(remoteAddress) ?? 0;
    if (pending >= maxPendingConnectionsPerIp || pendingTotal >= maxPendingConnectionsTotal) {
      socket.close(1013, 'too many pending connections');
      return;
    }
    pendingByIp.set(remoteAddress, pending + 1);
    pendingTotal += 1;
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) {
        return;
      }
      pendingReleased = true;
      pendingTotal = Math.max(0, pendingTotal - 1);
      const next = (pendingByIp.get(remoteAddress) ?? 1) - 1;
      if (next <= 0) {
        pendingByIp.delete(remoteAddress);
      } else {
        pendingByIp.set(remoteAddress, next);
      }
    };

    const helloTimer = setTimeout(() => socket.close(1008, 'hello required'), 5000);

    // The pre-hello phase ends as soon as the first message arrives (handleHello
    // either establishes a client or closes the socket) or the socket closes.
    socket.on('message', (raw) => {
      releasePending();
      handleHello(socket, raw, helloTimer, remoteAddress);
    });
    socket.on('close', () => {
      releasePending();
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
      if (client.socket.readyState !== client.socket.OPEN) {
        continue;
      }
      // No pong since the last ping -> the connection is a zombie; drop it.
      // Closes dead/slowloris connections within ~2 heartbeat cycles.
      if (!client.isAlive) {
        client.socket.terminate();
        continue;
      }
      client.isAlive = false;
      client.socket.ping();
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
    cleanupDisconnectedPlayers,
    getStats: () => ({
      rooms: rooms.size,
      clients: clients.size,
      roomCreationWindows: roomCreationWindows.size,
      pendingConnections: pendingByIp.size
    })
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
