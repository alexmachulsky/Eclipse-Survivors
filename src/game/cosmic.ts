import { randomBetween } from './collisions';

export interface TwinkleStar {
  x: number;
  y: number;
  radius: number;
  color: string;
  speed: number;
  phase: number;
}

export interface CosmicLayers {
  farTile: HTMLCanvasElement;
  midTile: HTMLCanvasElement;
  floorTile: HTMLCanvasElement;
  tileSize: number;
  twinkleStars: TwinkleStar[];
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function alphaHex(alpha: number): string {
  return Math.round(alpha * 255).toString(16).padStart(2, '0');
}

export function buildCosmicLayers(
  viewW: number,
  viewH: number,
  arenaW: number,
  arenaH: number,
  rng: () => number
): CosmicLayers {
  const tileSize = Math.ceil(Math.max(1600, Math.max(viewW, viewH) * 1.35));

  // ---- FAR TILE: nebula blobs + 420 tiny dim stars (screen-space, parallax 0.1) ----
  const far = makeCanvas(tileSize, tileSize);
  const farCtx = far.getContext('2d')!;

  // Transparent base — backdrop gradient shows through; nebula blobs add color on top
  farCtx.clearRect(0, 0, tileSize, tileSize);

  const nebulaBlobs = [
    { color: '#5eead4', alpha: 0.16 },
    { color: '#8b5cf6', alpha: 0.20 },
    { color: '#c084fc', alpha: 0.17 },
    { color: '#ff5edb', alpha: 0.13 },
    { color: '#38bdf8', alpha: 0.14 },
    { color: '#a78bfa', alpha: 0.18 },
    { color: '#f0abfc', alpha: 0.12 },
  ];
  for (const blob of nebulaBlobs) {
    const cx = randomBetween(tileSize * 0.05, tileSize * 0.95, rng);
    const cy = randomBetween(tileSize * 0.05, tileSize * 0.95, rng);
    const r  = randomBetween(tileSize * 0.32,  tileSize * 0.75, rng);
    const grad = farCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, blob.color + alphaHex(blob.alpha));
    grad.addColorStop(1, blob.color + '00');
    farCtx.fillStyle = grad;
    farCtx.fillRect(0, 0, tileSize, tileSize);
  }

  const tinyColors = ['#ffffff', '#a8e0ff', '#fff3b0', '#c0c8ff'];
  for (let i = 0; i < 420; i++) {
    const x = randomBetween(0, tileSize, rng);
    const y = randomBetween(0, tileSize, rng);
    farCtx.globalAlpha = randomBetween(0.16, 0.62, rng);
    farCtx.fillStyle = tinyColors[Math.floor(rng() * tinyColors.length)];
    farCtx.beginPath();
    farCtx.arc(x, y, randomBetween(0.35, 0.95, rng), 0, Math.PI * 2);
    farCtx.fill();
  }
  farCtx.globalAlpha = 1;

  // ---- MID TILE: 230 medium stars + faint constellation lines (parallax 0.4) ----
  const mid = makeCanvas(tileSize, tileSize);
  const midCtx = mid.getContext('2d')!;
  midCtx.clearRect(0, 0, tileSize, tileSize);

  const midColors = ['#ffffff', '#a8e0ff', '#fff3b0', '#e0f0ff', '#ffecff'];
  const starPos: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 230; i++) {
    const x = randomBetween(0, tileSize, rng);
    const y = randomBetween(0, tileSize, rng);
    midCtx.globalAlpha = randomBetween(0.28, 0.82, rng);
    midCtx.fillStyle = midColors[Math.floor(rng() * midColors.length)];
    midCtx.beginPath();
    midCtx.arc(x, y, randomBetween(0.55, 1.7, rng), 0, Math.PI * 2);
    midCtx.fill();
    starPos.push({ x, y });
  }

  midCtx.globalAlpha = 0.06;
  midCtx.strokeStyle = '#5eead4';
  midCtx.lineWidth = 0.5;
  for (let i = 0; i < 24; i++) {
    const a = starPos[Math.floor(rng() * starPos.length)];
    const b = starPos[Math.floor(rng() * starPos.length)];
    if (Math.hypot(a.x - b.x, a.y - b.y) < tileSize * 0.22) {
      midCtx.beginPath();
      midCtx.moveTo(a.x, a.y);
      midCtx.lineTo(b.x, b.y);
      midCtx.stroke();
    }
  }
  midCtx.globalAlpha = 1;

  // ---- FLOOR TILE: baked arena grid + 220 scattered hero stars (world-space, parallax 1.0) ----
  const floor = makeCanvas(arenaW, arenaH);
  const floorCtx = floor.getContext('2d')!;

  // Semi-transparent dark base so the arena reads as space instead of a black plate.
  floorCtx.fillStyle = 'rgba(7, 9, 20, 0.28)';
  floorCtx.fillRect(0, 0, arenaW, arenaH);

  const floorNebulaBlobs = [
    { color: '#5eead4', alpha: 0.12 },
    { color: '#38bdf8', alpha: 0.10 },
    { color: '#8b5cf6', alpha: 0.14 },
    { color: '#c084fc', alpha: 0.11 },
    { color: '#ff5edb', alpha: 0.08 },
    { color: '#a78bfa', alpha: 0.10 },
  ];
  for (const blob of floorNebulaBlobs) {
    const cx = randomBetween(arenaW * 0.08, arenaW * 0.92, rng);
    const cy = randomBetween(arenaH * 0.08, arenaH * 0.92, rng);
    const r = randomBetween(Math.min(arenaW, arenaH) * 0.22, Math.min(arenaW, arenaH) * 0.46, rng);
    const grad = floorCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, blob.color + alphaHex(blob.alpha));
    grad.addColorStop(1, blob.color + '00');
    floorCtx.fillStyle = grad;
    floorCtx.fillRect(0, 0, arenaW, arenaH);
  }

  // Grid stays present for orientation, with brighter major lines every four cells.
  floorCtx.lineWidth = 1;
  for (let x = 0; x <= arenaW; x += 96) {
    const major = x % 384 === 0;
    floorCtx.globalAlpha = major ? 0.18 : 0.10;
    floorCtx.strokeStyle = major ? '#2a6f8c' : '#1f4963';
    floorCtx.beginPath();
    floorCtx.moveTo(x, 0);
    floorCtx.lineTo(x, arenaH);
    floorCtx.stroke();
  }
  for (let y = 0; y <= arenaH; y += 96) {
    const major = y % 384 === 0;
    floorCtx.globalAlpha = major ? 0.18 : 0.10;
    floorCtx.strokeStyle = major ? '#2a6f8c' : '#1f4963';
    floorCtx.beginPath();
    floorCtx.moveTo(0, y);
    floorCtx.lineTo(arenaW, y);
    floorCtx.stroke();
  }
  floorCtx.globalAlpha = 1;

  // Baked hero stars scattered across the arena
  const heroColors = ['#ffffff', '#a8e0ff', '#fff3b0'];
  const largeHeroStars = 18;
  for (let i = 0; i < 220; i++) {
    const x = randomBetween(50, arenaW - 50, rng);
    const y = randomBetween(50, arenaH - 50, rng);
    const large = i < largeHeroStars;
    const r = large ? randomBetween(1.5, 2.7, rng) : randomBetween(0.45, 1.2, rng);
    floorCtx.globalAlpha = large ? randomBetween(0.35, 0.75, rng) : randomBetween(0.18, 0.55, rng);
    floorCtx.fillStyle = heroColors[Math.floor(rng() * heroColors.length)];
    if (large) {
      floorCtx.shadowBlur = 5;
      floorCtx.shadowColor = floorCtx.fillStyle;
    }
    floorCtx.beginPath();
    floorCtx.arc(x, y, r, 0, Math.PI * 2);
    floorCtx.fill();
    floorCtx.shadowBlur = 0;
  }
  floorCtx.globalAlpha = 1;

  // ---- TWINKLE STARS: 18 world-space stars animated per-frame with sin alpha ----
  // Placed in outer 30% of arena to avoid cluttering gameplay center
  const twinkleColors = ['#ffffff', '#a8e0ff', '#fff3b0', '#e0f0ff'];
  const twinkleStars: TwinkleStar[] = [];
  for (let i = 0; i < 18; i++) {
    let x: number, y: number;
    if (rng() < 0.5) {
      x = rng() < 0.5
        ? randomBetween(80, arenaW * 0.28, rng)
        : randomBetween(arenaW * 0.72, arenaW - 80, rng);
      y = randomBetween(80, arenaH - 80, rng);
    } else {
      x = randomBetween(80, arenaW - 80, rng);
      y = rng() < 0.5
        ? randomBetween(80, arenaH * 0.28, rng)
        : randomBetween(arenaH * 0.72, arenaH - 80, rng);
    }
    twinkleStars.push({
      x,
      y,
      radius: randomBetween(1.0, 2.3, rng),
      color: twinkleColors[Math.floor(rng() * twinkleColors.length)],
      speed: randomBetween(0.8, 2.2, rng),
      phase: randomBetween(0, Math.PI * 2, rng),
    });
  }

  return { farTile: far, midTile: mid, floorTile: floor, tileSize, twinkleStars };
}

function drawTiled(
  ctx: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  tileSize: number,
  viewportX: number,
  viewportY: number,
  parallax: number,
  viewW: number,
  viewH: number
): void {
  const rawX = -(viewportX * parallax);
  const rawY = -(viewportY * parallax);
  const ox = ((rawX % tileSize) + tileSize) % tileSize;
  const oy = ((rawY % tileSize) + tileSize) % tileSize;
  for (let tx = ox - tileSize; tx < viewW + tileSize; tx += tileSize) {
    for (let ty = oy - tileSize; ty < viewH + tileSize; ty += tileSize) {
      ctx.drawImage(tile, tx, ty);
    }
  }
}

export function drawCosmicBackground(
  ctx: CanvasRenderingContext2D,
  layers: CosmicLayers,
  viewportX: number,
  viewportY: number,
  viewW: number,
  viewH: number,
  fast = false
): void {
  // Deep-space gradient backdrop
  const gradient = ctx.createLinearGradient(0, 0, viewW, viewH);
  gradient.addColorStop(0,    '#050711');
  gradient.addColorStop(0.35, '#0d0a24');
  gradient.addColorStop(0.7,  '#1a0d2e');
  gradient.addColorStop(1,    '#070514');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, viewW, viewH);

  // Far nebula layer (barely drifts)
  drawTiled(ctx, layers.farTile, layers.tileSize, viewportX, viewportY, 0.1, viewW, viewH);

  if (fast) {
    return;
  }

  // Mid star layer (drifts noticeably slower than world)
  drawTiled(ctx, layers.midTile, layers.tileSize, viewportX, viewportY, 0.4, viewW, viewH);
}

export function drawTwinkleStars(
  ctx: CanvasRenderingContext2D,
  twinkleStars: TwinkleStar[],
  elapsed: number
): void {
  for (const star of twinkleStars) {
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(elapsed * star.speed + star.phase);
    ctx.fillStyle = star.color;
    if (star.radius > 1.5) {
      ctx.shadowBlur = 6;
      ctx.shadowColor = star.color;
    }
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}
