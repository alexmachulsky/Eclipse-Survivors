import { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../game/GameEngine';
import {
  beginFrame,
  beginRender,
  beginUpdate,
  endFrame,
  endRender,
  endUpdate,
  summary,
  type PerfSummary
} from '../game/perf';
import type { MultiplayerGameState, PlayerCommand, Projectile, Vector } from '../game/types';
import { clamp } from '../game/collisions';

interface TimedSnapshot {
  state: MultiplayerGameState;
  t: number; // performance.now() at receipt
}

function lerpV(ax: number, ay: number, bx: number, by: number, t: number): { x: number; y: number } {
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
}

function interpProjectiles(prev: Projectile[], curr: Projectile[], t: number, extraDt: number): Projectile[] {
  const prevMap = new Map(prev.map(p => [p.id, p]));
  return curr.map(p => {
    const prevP = prevMap.get(p.id);
    const base = prevP ? lerpV(prevP.position.x, prevP.position.y, p.position.x, p.position.y, t) : p.position;
    return { ...p, position: { x: base.x + p.velocity.x * extraDt, y: base.y + p.velocity.y * extraDt } };
  });
}

// Interpolate (and lightly extrapolate) between two server snapshots.
// alpha = elapsed / snapshotInterval — 0..1 interpolates, >1 extrapolates.
function interpolateState(prev: MultiplayerGameState, curr: MultiplayerGameState, alpha: number, snapshotMs: number): MultiplayerGameState {
  const t = Math.min(alpha, 1);
  // Cap extrapolation so a missed snapshot doesn't fling entities across the map.
  const extraDt = Math.min(Math.max(alpha - 1, 0), 1.5) * (snapshotMs / 1000);

  const prevPlayerMap = new Map(prev.players.map(p => [p.id, p]));
  const prevEnemyMap = new Map(prev.enemies.map(e => [e.id, e]));

  const players = curr.players.map(runtime => {
    const prevR = prevPlayerMap.get(runtime.id);
    if (!prevR) return runtime;
    const pos = lerpV(prevR.player.position.x, prevR.player.position.y, runtime.player.position.x, runtime.player.position.y, t);
    return { ...runtime, player: { ...runtime.player, position: pos } };
  });

  const enemies = curr.enemies.map(e => {
    const prevE = prevEnemyMap.get(e.id);
    const base = prevE ? lerpV(prevE.position.x, prevE.position.y, e.position.x, e.position.y, t) : e.position;
    return { ...e, position: { x: base.x + e.velocity.x * extraDt, y: base.y + e.velocity.y * extraDt } };
  });

  return {
    ...curr,
    players,
    enemies,
    playerProjectiles: interpProjectiles(prev.playerProjectiles, curr.playerProjectiles, t, extraDt),
    enemyProjectiles: interpProjectiles(prev.enemyProjectiles, curr.enemyProjectiles, t, extraDt),
  };
}

interface LanGameCanvasProps {
  state: MultiplayerGameState | null;
  localPlayerId: string | null;
  sendCommand: (command: PlayerCommand) => void;
}

const keyMap: Record<string, 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'> = {
  KeyW: 'moveUp',
  ArrowUp: 'moveUp',
  KeyS: 'moveDown',
  ArrowDown: 'moveDown',
  KeyA: 'moveLeft',
  ArrowLeft: 'moveLeft',
  KeyD: 'moveRight',
  ArrowRight: 'moveRight'
};

const MAX_CANVAS_PIXEL_RATIO = 1;

function FpsOverlay({ metrics, fast }: { metrics: PerfSummary | null; fast: boolean }) {
  return (
    <div className="fps-overlay" aria-label="Performance debug overlay">
      <span>FPS {metrics ? metrics.fps : '--'}{fast ? ' FAST' : ''}</span>
      {metrics && (
        <span>
          frame {metrics.p50Frame}/{metrics.p95Frame}ms · render {metrics.renderP50}/{metrics.renderP95}ms
        </span>
      )}
    </div>
  );
}

function screenToWorld(state: MultiplayerGameState, localPlayerId: string, viewSize: { width: number; height: number }, screen: Vector): Vector {
  const runtime = state.players.find((player) => player.id === localPlayerId) ?? state.players[0];
  const width = viewSize.width;
  const height = viewSize.height;
  const x = clamp((runtime?.player.position.x ?? 1600) - width / 2, 0, Math.max(0, state.arena.width - width));
  const y = clamp((runtime?.player.position.y ?? 1200) - height / 2, 0, Math.max(0, state.arena.height - height));

  return {
    x: x + screen.x,
    y: y + screen.y
  };
}

export function LanGameCanvas({ state, localPlayerId, sendCommand }: LanGameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const prevSnapshotRef = useRef<TimedSnapshot | null>(null);
  const currSnapshotRef = useRef<TimedSnapshot | null>(null);
  const snapshotIntervalRef = useRef(50); // ms, exponential moving average
  const localPlayerIdRef = useRef<string | null>(localPlayerId);
  const keysRef = useRef({
    moveUp: false,
    moveDown: false,
    moveLeft: false,
    moveRight: false,
    reviveHeld: false,
    dashHeld: false
  });
  const mouseRef = useRef<Vector>({ x: 0, y: 0 });
  const viewSizeRef = useRef({ width: 1280, height: 720 });
  const seqRef = useRef(0);
  const cmdTimerRef = useRef(0); // seconds since last command sent
  const lastSentKeysRef = useRef({ moveUp: false, moveDown: false, moveLeft: false, moveRight: false, reviveHeld: false, dashHeld: false });
  // Client-side prediction: locally simulate the local player's position so it
  // responds instantly to input instead of waiting for a server round-trip.
  const predictedPosRef = useRef<Vector | null>(null);
  const debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [fastMode, setFastMode] = useState(false);

  useEffect(() => {
    if (!state) return;
    const now = performance.now();
    if (currSnapshotRef.current) {
      const gap = now - currSnapshotRef.current.t;
      // Exponential moving average to track server snapshot cadence.
      snapshotIntervalRef.current = snapshotIntervalRef.current * 0.85 + gap * 0.15;
      prevSnapshotRef.current = currSnapshotRef.current;
    }
    currSnapshotRef.current = { state, t: now };
  }, [state]);

  useEffect(() => {
    localPlayerIdRef.current = localPlayerId;
  }, [localPlayerId]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext('2d');
    const engine = new GameEngine();
    let frameId = 0;
    let lastTime = performance.now();
    let fpsTimer = 0;
    let fpsFrames = 0;

    if (!context) {
      return undefined;
    }

    engineRef.current = engine;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PIXEL_RATIO);
      canvas.width = Math.floor(rect.width * pixelRatio);
      canvas.height = Math.floor(rect.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      viewSizeRef.current = { width: rect.width, height: rect.height };
      engine.setViewSize(rect.width, rect.height);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    engine.preloadRenderAssets();

    const loop = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      beginFrame(lastTime);
      lastTime = time;
      beginUpdate();
      endUpdate();

      const curr = currSnapshotRef.current;
      const prev = prevSnapshotRef.current;
      const currentPlayerId = localPlayerIdRef.current;

      if (curr && currentPlayerId) {
        // Interpolate/extrapolate between the two most recent server snapshots
        // so entities move smoothly at 60 fps instead of teleporting at 30 Hz.
        const elapsed = performance.now() - curr.t;
        const interval = snapshotIntervalRef.current;
        const alpha = elapsed / interval;
        const displayState = prev
          ? interpolateState(prev.state, curr.state, alpha, interval)
          : curr.state;

        // === Client-side prediction for the local player ===
        // Move the local player based on input immediately, instead of waiting
        // for the server snapshot to come back. The server remains authoritative
        // — when its position diverges, we smoothly blend predicted -> server.
        const localRuntime = curr.state.players.find((p) => p.id === currentPlayerId);
        let finalState = displayState;
        if (localRuntime && localRuntime.status === 'active') {
          if (!predictedPosRef.current) {
            predictedPosRef.current = { x: localRuntime.player.position.x, y: localRuntime.player.position.y };
          }
          const k = keysRef.current;
          const dirX = (k.moveRight ? 1 : 0) - (k.moveLeft ? 1 : 0);
          const dirY = (k.moveDown ? 1 : 0) - (k.moveUp ? 1 : 0);
          const len = Math.hypot(dirX, dirY);
          if (len > 0) {
            const speed = localRuntime.player.speed;
            const radius = localRuntime.player.radius;
            const arena = curr.state.arena;
            predictedPosRef.current.x = clamp(predictedPosRef.current.x + (dirX / len) * speed * dt, radius, arena.width - radius);
            predictedPosRef.current.y = clamp(predictedPosRef.current.y + (dirY / len) * speed * dt, radius, arena.height - radius);
          }
          // Reconcile against server: snap on huge divergence (teleport, knockback),
          // otherwise blend a small fraction toward server every frame.
          const serverPos = localRuntime.player.position;
          const dxc = serverPos.x - predictedPosRef.current.x;
          const dyc = serverPos.y - predictedPosRef.current.y;
          if (dxc * dxc + dyc * dyc > 120 * 120) {
            predictedPosRef.current.x = serverPos.x;
            predictedPosRef.current.y = serverPos.y;
          } else {
            predictedPosRef.current.x += dxc * 0.12;
            predictedPosRef.current.y += dyc * 0.12;
          }
          // Override the local player's position in the rendered state.
          const predicted = predictedPosRef.current;
          finalState = {
            ...displayState,
            players: displayState.players.map((p) =>
              p.id === currentPlayerId
                ? { ...p, player: { ...p.player, position: { x: predicted.x, y: predicted.y } } }
                : p
            )
          };
        } else if (localRuntime && localRuntime.status !== 'active') {
          // Reset prediction when down/dead so a respawn snaps to server.
          predictedPosRef.current = null;
        }

        engine.loadMultiplayerState(finalState, currentPlayerId);

        // Send input commands: immediately on input change, throttled to 30 Hz otherwise.
        cmdTimerRef.current += dt;
        const k2 = keysRef.current;
        const lastK = lastSentKeysRef.current;
        const inputChanged =
          k2.moveUp !== lastK.moveUp ||
          k2.moveDown !== lastK.moveDown ||
          k2.moveLeft !== lastK.moveLeft ||
          k2.moveRight !== lastK.moveRight ||
          k2.reviveHeld !== lastK.reviveHeld ||
          k2.dashHeld !== lastK.dashHeld;
        if (inputChanged || cmdTimerRef.current >= 1 / 30) {
          cmdTimerRef.current = 0;
          lastSentKeysRef.current = { ...k2 };
          const aim = screenToWorld(curr.state, currentPlayerId, viewSizeRef.current, mouseRef.current);
          sendCommand({
            type: 'command',
            playerId: currentPlayerId,
            seq: seqRef.current,
            moveUp: k2.moveUp,
            moveDown: k2.moveDown,
            moveLeft: k2.moveLeft,
            moveRight: k2.moveRight,
            aimWorldX: aim.x,
            aimWorldY: aim.y,
            reviveHeld: k2.reviveHeld,
            dashHeld: k2.dashHeld
          });
          keysRef.current.dashHeld = false;
          seqRef.current += 1;
        }
      }

      beginRender();
      engine.render(context);
      endRender();
      endFrame(time);
      fpsTimer += dt;
      fpsFrames += 1;

      if (fpsTimer >= 0.25) {
        const fps = fpsFrames / fpsTimer;
        if (fps < 58) {
          engine.setPerformanceMode(true);
        } else if (fps >= 59.5) {
          engine.setPerformanceMode(false);
        }

        if (debugEnabled) {
          setPerfSummary(summary());
          setFastMode(engine.isPerformanceMode());
        }

        fpsTimer = 0;
        fpsFrames = 0;
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    const onKeyDown = (event: KeyboardEvent) => {
      const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const mapped = keyMap[event.code];

      if (mapped) {
        keysRef.current[mapped] = true;
        if (!isTyping) event.preventDefault();
      }

      if (event.code === 'Space' && !isTyping) {
        if (!event.repeat) {
          keysRef.current.dashHeld = true;
        }
        event.preventDefault();
      }

      if (event.code === 'KeyE' && !isTyping) {
        keysRef.current.reviveHeld = true;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const mapped = keyMap[event.code];

      if (mapped) {
        keysRef.current[mapped] = false;
        if (!isTyping) event.preventDefault();
      }

      if (event.code === 'KeyE' && !isTyping) {
        keysRef.current.reviveHeld = false;
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
    };
  }, [debugEnabled, sendCommand]);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" aria-label="Space Raiders LAN playfield" />
      {debugEnabled && <FpsOverlay metrics={perfSummary} fast={fastMode} />}
    </>
  );
}

