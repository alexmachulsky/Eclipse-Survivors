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

    if (!context) {
      return undefined;
    }

    engineRef.current = engine;
    onReady(engine);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * pixelRatio);
      canvas.height = Math.floor(rect.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      engine.setViewSize(rect.width, rect.height);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const loop = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;
      engine.update(dt);
      engine.render(context);
      snapshotTimer += dt;

      if (snapshotTimer > 1 / 20) {
        onSnapshot(engine.getSnapshot());
        snapshotTimer = 0;
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);

    const onKeyDown = (event: KeyboardEvent) => {
      const mapped = keyMap[event.code];

      if (mapped) {
        engine.setMovement({ [mapped]: true });
        event.preventDefault();
      }

      if (event.code === 'Escape') {
        engine.togglePause();
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
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
    };
  }, [onReady, onSnapshot]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Eclipse Survivors playfield" />;
}
