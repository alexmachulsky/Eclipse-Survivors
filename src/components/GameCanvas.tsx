import { useEffect, useRef } from 'react';
import { GameEngine, type GameSnapshot } from '../game/GameEngine';

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

export function GameCanvas({ onReady, onSnapshot }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

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
    let fpsOverlay: HTMLDivElement | null = null;

    if (!context) {
      return undefined;
    }

    engineRef.current = engine;
    onReady(engine);

    if (new URLSearchParams(window.location.search).has('debug')) {
      fpsOverlay = document.createElement('div');
      fpsOverlay.style.position = 'absolute';
      fpsOverlay.style.top = '12px';
      fpsOverlay.style.right = '12px';
      fpsOverlay.style.zIndex = '20';
      fpsOverlay.style.padding = '6px 9px';
      fpsOverlay.style.border = '1px solid rgba(94, 234, 212, 0.35)';
      fpsOverlay.style.borderRadius = '6px';
      fpsOverlay.style.background = 'rgba(5, 7, 17, 0.76)';
      fpsOverlay.style.color = '#d3fff5';
      fpsOverlay.style.font = '700 12px Inter, system-ui, sans-serif';
      fpsOverlay.style.fontVariantNumeric = 'tabular-nums';
      fpsOverlay.textContent = 'FPS --';
      canvas.parentElement?.appendChild(fpsOverlay);
    }

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
      lastTime = time;
      engine.update(dt);
      engine.render(context);
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

        if (fpsOverlay) {
          fpsOverlay.textContent = `FPS ${Math.round(fps)}${engine.isPerformanceMode() ? ' FAST' : ''}`;
        }

        fpsTimer = 0;
        fpsFrames = 0;
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    const onKeyDown = (event: KeyboardEvent) => {
      const mapped = keyMap[event.code];
      const debug = new URLSearchParams(window.location.search).has('debug');

      if (mapped) {
        engine.setMovement({ [mapped]: true });
        event.preventDefault();
      }

      if (event.code === 'Escape') {
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
      const mapped = keyMap[event.code];

      if (mapped) {
        engine.setMovement({ [mapped]: false });
        event.preventDefault();
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
      fpsOverlay?.remove();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
    };
  }, [onReady, onSnapshot]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Eclipse Survivors playfield" />;
}
