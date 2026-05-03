import type { EnemyType } from './types';

export interface SpriteAsset {
  image: CanvasImageSource;
  size: number;
}

type EnemySprites = Record<EnemyType, {
  normal: SpriteAsset;
  hit: SpriteAsset;
  lite: SpriteAsset;
}>;

export interface RenderAssets {
  player: SpriteAsset;
  playerHit: SpriteAsset;
  enemies: EnemySprites;
  projectiles: {
    arrow: SpriteAsset;
    bolt: SpriteAsset;
    pulse: SpriteAsset;
    ranged: SpriteAsset;
  };
  gem: SpriteAsset;
  healthPickup: SpriteAsset;
  rewardChest: {
    elite: SpriteAsset;
    objective: SpriteAsset;
  };
  orbit: {
    normal: SpriteAsset;
    evolved: SpriteAsset;
  };
  hitFlash: SpriteAsset;
}

let assets: RenderAssets | null = null;
let builds = 0;

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createSprite(size: number, draw: (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, unit: number) => void): SpriteAsset {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('2D canvas context unavailable for render asset');
  }

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  draw(ctx, size / 64);
  ctx.restore();

  return { image: canvas as CanvasImageSource, size };
}

function radial(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  inner: number,
  outer: number,
  innerColor: string,
  outerColor: string
): void {
  const gradient = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(1, outerColor);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, Math.PI * 2);
  ctx.fill();
}

function polygon(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  radius: number,
  sides: number,
  rotation: number
): void {
  ctx.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function shadowBlob(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rx: number, ry: number, y: number): void {
  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function buildPlayer(hit = false): SpriteAsset {
  return createSprite(112, (ctx, unit) => {
    const r = 15 * unit;

    shadowBlob(ctx, r * 1.3, r * 0.42, r * 0.9);
    radial(ctx, r * 0.35, r * 2.05, hit ? 'rgba(255,255,255,0.56)' : 'rgba(94,234,212,0.58)', 'rgba(94,234,212,0)');

    const hull = ctx.createRadialGradient(-r * 0.2, -r * 0.2, r * 0.1, 0, 0, r);
    hull.addColorStop(0, hit ? '#ffffff' : '#5eead4');
    hull.addColorStop(0.45, hit ? '#dbeafe' : '#143451');
    hull.addColorStop(1, hit ? '#94a3b8' : '#081324');

    ctx.fillStyle = hull;
    ctx.strokeStyle = hit ? '#ffffff' : '#5eead4';
    ctx.lineWidth = 2.4 * unit;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.02, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = hit ? '#ffffff' : '#d3fff5';
    radial(ctx, 0, r * 0.55, hit ? '#ffffff' : '#d3fff5', 'rgba(94,234,212,0)');

    const prow = ctx.createLinearGradient(r * 0.2, 0, r * 1.9, 0);
    prow.addColorStop(0, '#ffd166');
    prow.addColorStop(1, '#fff3b0');
    ctx.fillStyle = hit ? '#ffffff' : prow;
    ctx.strokeStyle = 'rgba(255,243,176,0.82)';
    ctx.lineWidth = 1.3 * unit;
    ctx.beginPath();
    ctx.moveTo(r * 1.85, 0);
    ctx.lineTo(r * 0.24, -r * 0.58);
    ctx.lineTo(r * 0.55, 0);
    ctx.lineTo(r * 0.24, r * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.48)';
    ctx.lineWidth = 1.1 * unit;
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.34);
    ctx.lineTo(r * 0.3, -r * 0.18);
    ctx.moveTo(-r * 0.72, r * 0.34);
    ctx.lineTo(r * 0.3, r * 0.18);
    ctx.stroke();
  });
}

function buildBasicEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 72 : 96, (ctx, unit) => {
    const r = 15 * unit;
    if (!lite) {
      radial(ctx, r * 0.4, r * 1.75, 'rgba(124,247,255,0.48)', 'rgba(124,247,255,0)');
    }

    const body = ctx.createRadialGradient(-r * 0.28, -r * 0.3, 0, 0, 0, r);
    body.addColorStop(0, hit ? '#ffffff' : '#bdfcff');
    body.addColorStop(0.55, hit ? '#e0f2fe' : '#1ec9d6');
    body.addColorStop(1, hit ? '#93c5fd' : '#0a3a44');

    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#1ec9d6') : body;
    ctx.strokeStyle = 'rgba(186,252,255,0.74)';
    ctx.lineWidth = 1.5 * unit;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#07111e';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(r * 0.32, side * r * 0.3, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function buildFastEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 74 : 104, (ctx, unit) => {
    const r = 15 * unit;

    if (!lite) {
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = '#ff5edb';
      for (let index = 1; index <= 2; index += 1) {
        ctx.beginPath();
        ctx.moveTo(-r * (0.7 + index * 0.45), 0);
        ctx.lineTo(-r * (1.05 + index * 0.45), -r * 0.5);
        ctx.lineTo(-r * (0.92 + index * 0.45), 0);
        ctx.lineTo(-r * (1.05 + index * 0.45), r * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const body = ctx.createLinearGradient(-r * 0.9, 0, r * 1.25, 0);
    body.addColorStop(0, hit ? '#ffffff' : '#881b6f');
    body.addColorStop(0.55, hit ? '#fce7f3' : '#ff5edb');
    body.addColorStop(1, hit ? '#ffffff' : '#ffb8f0');

    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#ff5edb') : body;
    ctx.strokeStyle = 'rgba(255,232,250,0.72)';
    ctx.lineWidth = 1.25 * unit;
    ctx.beginPath();
    ctx.moveTo(r * 1.32, 0);
    ctx.lineTo(-r * 0.7, -r * 0.86);
    ctx.lineTo(-r * 0.22, 0);
    ctx.lineTo(-r * 0.7, r * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff7ad';
    ctx.beginPath();
    ctx.arc(-r * 0.75, 0, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  });
}

function buildTankEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 86 : 108, (ctx, unit) => {
    const r = 18 * unit;
    shadowBlob(ctx, r * 1.05, r * 0.32, r * 0.65);

    const body = ctx.createRadialGradient(-r * 0.24, -r * 0.2, 0, 0, 0, r);
    body.addColorStop(0, hit ? '#ffffff' : '#dcd0ff');
    body.addColorStop(0.56, hit ? '#ddd6fe' : '#3a2a6e');
    body.addColorStop(1, hit ? '#a5b4fc' : '#0e0a1f');

    polygon(ctx, r, 6, Math.PI / 6);
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#a78bfa') : body;
    ctx.strokeStyle = '#dcd0ff';
    ctx.lineWidth = 2 * unit;
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      ctx.strokeStyle = 'rgba(20,8,48,0.74)';
      ctx.lineWidth = 1.7 * unit;
      ctx.beginPath();
      for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 6 + (Math.PI * 2 * index) / 6;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.stroke();

      ctx.fillStyle = '#ede9fe';
      for (let index = 0; index < 6; index += 1) {
        const angle = Math.PI / 6 + (Math.PI * 2 * index) / 6;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * r * 0.55, Math.sin(angle) * r * 0.55, r * 0.065, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

function buildRangedEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 78 : 102, (ctx, unit) => {
    const r = 16 * unit;
    if (!lite) {
      radial(ctx, r * 0.2, r * 1.65, 'rgba(255,209,102,0.42)', 'rgba(255,209,102,0)');
    }

    const body = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    body.addColorStop(0, hit ? '#ffffff' : '#fff3b0');
    body.addColorStop(0.54, hit ? '#fef3c7' : '#ffb84d');
    body.addColorStop(1, hit ? '#facc15' : '#6b3a05');

    polygon(ctx, r, 4, Math.PI / 4);
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#ffd166') : body;
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 2 * unit;
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      radial(ctx, 0, r * 0.44, 'rgba(255,255,255,0.92)', 'rgba(255,209,102,0)');
    }
  });
}

function buildBossEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 154 : 216, (ctx, unit) => {
    const r = 29 * unit;
    if (!lite) {
      radial(ctx, r * 0.7, r * 1.78, 'rgba(255,51,95,0.48)', 'rgba(255,51,95,0)');
      radial(ctx, r * 0.3, r * 1.18, 'rgba(255,150,90,0.4)', 'rgba(255,51,95,0)');
    }

    const body = ctx.createRadialGradient(-r * 0.18, -r * 0.22, 0, 0, 0, r);
    body.addColorStop(0, hit ? '#ffffff' : '#ffb199');
    body.addColorStop(0.48, hit ? '#fecdd3' : '#6e0c1f');
    body.addColorStop(1, hit ? '#fb7185' : '#1a0408');

    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#ff335f') : body;
    ctx.strokeStyle = 'rgba(255,209,102,0.72)';
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff3b0';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * r * 0.34, -r * 0.13, r * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function buildProjectile(kind: 'arrow' | 'bolt' | 'pulse' | 'ranged'): SpriteAsset {
  return createSprite(kind === 'pulse' ? 96 : 64, (ctx, unit) => {
    if (kind === 'arrow') {
      const r = 15 * unit;
      const body = ctx.createLinearGradient(-r, 0, r * 1.35, 0);
      body.addColorStop(0, '#6ee7b7');
      body.addColorStop(1, '#eaff9c');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(r * 1.34, 0);
      ctx.lineTo(-r, -r * 0.42);
      ctx.lineTo(-r * 0.52, 0);
      ctx.lineTo(-r, r * 0.42);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (kind === 'pulse') {
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 3 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, 23 * unit, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const color = kind === 'ranged' ? '#ffd166' : '#6ee7ff';
    radial(ctx, 0, 10 * unit, '#ffffff', `${color}00`);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 5.5 * unit, 0, Math.PI * 2);
    ctx.fill();
  });
}

function buildGem(): SpriteAsset {
  return createSprite(52, (ctx, unit) => {
    const r = 10 * unit;
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#5eead4';
    ctx.strokeStyle = 'rgba(211,255,245,0.78)';
    ctx.lineWidth = 1.4 * unit;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
  });
}

function buildHealthPickup(): SpriteAsset {
  return createSprite(64, (ctx, unit) => {
    const r = 13 * unit;
    radial(ctx, r * 0.2, r * 1.75, 'rgba(251,113,133,0.42)', 'rgba(251,113,133,0)');
    ctx.fillStyle = '#fb7185';
    ctx.strokeStyle = '#fff7ed';
    ctx.lineWidth = 1.8 * unit;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.72);
    ctx.bezierCurveTo(-r * 1.15, -r * 0.15, -r * 0.72, -r * 0.95, 0, -r * 0.35);
    ctx.bezierCurveTo(r * 0.72, -r * 0.95, r * 1.15, -r * 0.15, 0, r * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, 0);
    ctx.lineTo(r * 0.35, 0);
    ctx.moveTo(0, -r * 0.35);
    ctx.lineTo(0, r * 0.35);
    ctx.stroke();
  });
}

function buildRewardChest(color: string): SpriteAsset {
  return createSprite(72, (ctx, unit) => {
    const r = 18 * unit;
    radial(ctx, r * 0.2, r * 1.7, `${color}66`, `${color}00`);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 2 * unit;
    polygon(ctx, r, 4, 0);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(5,7,17,0.72)';
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, 0);
    ctx.lineTo(r * 0.55, 0);
    ctx.stroke();
  });
}

function buildOrbit(evolved: boolean): SpriteAsset {
  return createSprite(72, (ctx, unit) => {
    const rx = (evolved ? 22 : 17) * unit;
    const ry = (evolved ? 9 : 7) * unit;
    radial(ctx, 0, rx * 1.35, 'rgba(240,171,252,0.34)', 'rgba(240,171,252,0)');
    ctx.fillStyle = evolved ? '#f5d0fe' : '#f0abfc';
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  });
}

function buildHitFlash(): SpriteAsset {
  return createSprite(80, (ctx, unit) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.arc(0, 0, 18 * unit, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function buildRenderAssets(): RenderAssets {
  const enemies: EnemySprites = {
    basic: { normal: buildBasicEnemy(), hit: buildBasicEnemy(true), lite: buildBasicEnemy(false, true) },
    fast: { normal: buildFastEnemy(), hit: buildFastEnemy(true), lite: buildFastEnemy(false, true) },
    tank: { normal: buildTankEnemy(), hit: buildTankEnemy(true), lite: buildTankEnemy(false, true) },
    ranged: { normal: buildRangedEnemy(), hit: buildRangedEnemy(true), lite: buildRangedEnemy(false, true) },
    boss: { normal: buildBossEnemy(), hit: buildBossEnemy(true), lite: buildBossEnemy(false, true) }
  };

  return {
    player: buildPlayer(),
    playerHit: buildPlayer(true),
    enemies,
    projectiles: {
      arrow: buildProjectile('arrow'),
      bolt: buildProjectile('bolt'),
      pulse: buildProjectile('pulse'),
      ranged: buildProjectile('ranged')
    },
    gem: buildGem(),
    healthPickup: buildHealthPickup(),
    rewardChest: {
      elite: buildRewardChest('#ffd166'),
      objective: buildRewardChest('#5eead4')
    },
    orbit: {
      normal: buildOrbit(false),
      evolved: buildOrbit(true)
    },
    hitFlash: buildHitFlash()
  };
}

export function preloadRenderAssets(): RenderAssets {
  if (!assets) {
    assets = buildRenderAssets();
    builds += 1;
  }

  return assets;
}

export function getRenderAssetStats(): { builds: number } {
  return { builds };
}

export function __resetRenderAssetsForTests(): void {
  assets = null;
  builds = 0;
}
