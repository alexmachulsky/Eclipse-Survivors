import { useEffect, useRef, useState } from 'react';
import { GameEngine, type GameSnapshot } from '../game/GameEngine';
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

interface GameCanvasProps {
  onReady: (engine: GameEngine) => void;
  onSnapshot: (snapshot: GameSnapshot) => void;
}

const keyMap: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right'
};

const MAX_CANVAS_PIXEL_RATIO = 1;

function FpsOverlay({ metrics, fast }: { metrics: PerfSummary | null; fast: boolean }) {
  return (
    <div className="fps-overlay" aria-label="Performance debug overlay">
      <span>FPS {metrics ? metrics.fps : '--'}{fast ? ' FAST' : ''}</span>
      {metrics && (
        <span>
          frame {metrics.p50Frame}/{metrics.p95Frame}ms · update {metrics.updateP50}/{metrics.updateP95}ms · render {metrics.renderP50}/{metrics.renderP95}ms
        </span>
      )}
    </div>
  );
}

export function GameCanvas({ onReady, onSnapshot }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [fastMode, setFastMode] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return undefined;
    }

    const engine = new GameEngine();
    const context = canvas.getContext('2d');
    let frameId = 0;
    let lastTime = performance.now();
    let snapshotTimer = 0;
    let fpsTimer = 0;
    let fpsFrames = 0;
    let lowFpsSamples = 0;
    let stableFpsSamples = 0;

    if (!context) {
      return undefined;
    }

    engineRef.current = engine;
    onReady(engine);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PIXEL_RATIO);
      canvas.width = Math.floor(rect.width * pixelRatio);
      canvas.height = Math.floor(rect.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
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
      engine.update(dt);
      endUpdate();
      beginRender();
      engine.render(context);
      endRender();
      endFrame(time);
      snapshotTimer += dt;
      fpsTimer += dt;
      fpsFrames += 1;

      if (snapshotTimer > 1 / 20) {
        onSnapshot(engine.getSnapshot());
        snapshotTimer = 0;
      }

      if (fpsTimer >= 0.25) {
        const fps = fpsFrames / fpsTimer;

        if (fps < 58) {
          lowFpsSamples += 1;
          stableFpsSamples = 0;
        } else if (fps >= 59.5) {
          stableFpsSamples += 1;
          lowFpsSamples = 0;
        } else {
          lowFpsSamples = 0;
          stableFpsSamples = 0;
        }

        if (lowFpsSamples >= 2) {
          engine.setPerformanceMode(true);
        } else if (stableFpsSamples >= 16) {
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
      const debug = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug');

      if (mapped) {
        engine.setMovement({ [mapped]: true });
        if (!isTyping) event.preventDefault();
      }

      if (event.code === 'Escape' && !isTyping) {
        engine.togglePause();
        onSnapshot(engine.getSnapshot());
      }

      if (debug) {
        if (event.code === 'F2') engine.debugLevelUp();
        if (event.code === 'F3') engine.debugOpenChest();
        if (event.code === 'F4') engine.debugSpawnObjective();
        if (event.code === 'F5') engine.debugSpawnElite();
        if (event.code === 'F6') engine.debugSpawnBoss();
        onSnapshot(engine.getSnapshot());
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      const mapped = keyMap[event.code];

      if (mapped) {
        engine.setMovement({ [mapped]: false });
        if (!isTyping) event.preventDefault();
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      engine.setMouse({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
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
  }, [debugEnabled, onReady, onSnapshot]);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" aria-label="Eclipse Survivors playfield" />
      {debugEnabled && <FpsOverlay metrics={perfSummary} fast={fastMode} />}
    </>
  );
}
