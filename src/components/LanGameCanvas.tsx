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
import type { MultiplayerGameState, PlayerCommand, Vector } from '../game/types';
import { clamp } from '../game/collisions';

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
  const latestStateRef = useRef<MultiplayerGameState | null>(state);
  const localPlayerIdRef = useRef<string | null>(localPlayerId);
  const keysRef = useRef({
    moveUp: false,
    moveDown: false,
    moveLeft: false,
    moveRight: false,
    reviveHeld: false
  });
  const mouseRef = useRef<Vector>({ x: 0, y: 0 });
  const viewSizeRef = useRef({ width: 1280, height: 720 });
  const seqRef = useRef(0);
  const debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [fastMode, setFastMode] = useState(false);

  useEffect(() => {
    latestStateRef.current = state;
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
      const dt = (time - lastTime) / 1000;
      beginFrame(lastTime);
      lastTime = time;
      beginUpdate();
      endUpdate();

      const currentState = latestStateRef.current;
      const currentPlayerId = localPlayerIdRef.current;

      if (currentState && currentPlayerId) {
        const aim = screenToWorld(currentState, currentPlayerId, viewSizeRef.current, mouseRef.current);
        sendCommand({
          type: 'command',
          playerId: currentPlayerId,
          seq: seqRef.current,
          moveUp: keysRef.current.moveUp,
          moveDown: keysRef.current.moveDown,
          moveLeft: keysRef.current.moveLeft,
          moveRight: keysRef.current.moveRight,
          aimWorldX: aim.x,
          aimWorldY: aim.y,
          reviveHeld: keysRef.current.reviveHeld
        });
        seqRef.current += 1;
        engine.loadMultiplayerState(currentState, currentPlayerId);
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
      const mapped = keyMap[event.code];

      if (mapped) {
        keysRef.current[mapped] = true;
        event.preventDefault();
      }

      if (event.code === 'KeyE') {
        keysRef.current.reviveHeld = true;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const mapped = keyMap[event.code];

      if (mapped) {
        keysRef.current[mapped] = false;
        event.preventDefault();
      }

      if (event.code === 'KeyE') {
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
      <canvas ref={canvasRef} className="game-canvas" aria-label="Eclipse Survivors LAN playfield" />
      {debugEnabled && <FpsOverlay metrics={perfSummary} fast={fastMode} />}
    </>
  );
}

