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
  return createSprite(128, (ctx, unit) => {
    const r = 14 * unit;

    shadowBlob(ctx, r * 1.28, r * 0.38, r * 0.88);
    radial(ctx, r * 0.3, r * 2.4,
      hit ? 'rgba(255,255,255,0.38)' : 'rgba(94,234,212,0.46)',
      'rgba(94,234,212,0)');

    // === Swept delta wings ===
    const wingGrad = ctx.createLinearGradient(-r * 0.95, 0, r * 0.2, 0);
    wingGrad.addColorStop(0, hit ? '#374151' : '#051525');
    wingGrad.addColorStop(1, hit ? '#93c5fd' : '#0d4b73');
    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = hit ? 'rgba(255,255,255,0.65)' : 'rgba(56,189,248,0.55)';
    ctx.lineWidth = 1.1 * unit;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(r * 0.18, s * r * 0.4);
      ctx.lineTo(-r * 0.5, s * r * 1.08);
      ctx.lineTo(-r * 0.95, s * r * 0.74);
      ctx.lineTo(-r * 0.58, s * r * 0.33);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (!hit) {
      ctx.strokeStyle = 'rgba(56,189,248,0.3)';
      ctx.lineWidth = 0.7 * unit;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.14, s * r * 0.4);
        ctx.lineTo(-r * 0.83, s * r * 0.76);
        ctx.stroke();
      }
    }

    // === Engine nacelles ===
    for (const s of [-1, 1]) {
      const ex = -r * 0.72;
      const ey = s * r * 0.46;
      ctx.fillStyle = hit ? '#b0d4f0' : '#081f33';
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.9)' : 'rgba(56,189,248,0.85)';
      ctx.lineWidth = 0.85 * unit;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.25, r * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!hit) {
        const eg = ctx.createRadialGradient(ex - r * 0.08, ey, 0, ex - r * 0.08, ey, r * 0.32);
        eg.addColorStop(0, 'rgba(255,255,255,0.97)');
        eg.addColorStop(0.3, 'rgba(56,189,248,0.82)');
        eg.addColorStop(0.62, 'rgba(99,102,241,0.34)');
        eg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(ex - r * 0.08, ey, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // === Main hull ===
    const hull = ctx.createRadialGradient(-r * 0.17, -r * 0.22, 0, 0, 0, r);
    hull.addColorStop(0, hit ? '#ffffff' : '#7cf7ff');
    hull.addColorStop(0.3, hit ? '#dbeafe' : '#0ea5e9');
    hull.addColorStop(0.7, hit ? '#64748b' : '#072540');
    hull.addColorStop(1, hit ? '#1e293b' : '#020b14');
    ctx.fillStyle = hull;
    ctx.strokeStyle = hit ? '#ffffff' : '#38bdf8';
    ctx.lineWidth = 1.8 * unit;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!hit) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 0.7 * unit;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.75, s * r * 0.22);
        ctx.quadraticCurveTo(r * 0.08, s * r * 0.34, r * 0.8, 0);
        ctx.stroke();
      }
    }

    // === Nose cone ===
    const prowGrad = ctx.createLinearGradient(r * 0.28, 0, r * 1.87, 0);
    prowGrad.addColorStop(0, '#f59e0b');
    prowGrad.addColorStop(0.55, '#fde68a');
    prowGrad.addColorStop(1, '#fff3b0');
    ctx.fillStyle = hit ? '#ffffff' : prowGrad;
    ctx.strokeStyle = 'rgba(255,243,176,0.8)';
    ctx.lineWidth = 1.05 * unit;
    ctx.beginPath();
    ctx.moveTo(r * 1.87, 0);
    ctx.lineTo(r * 0.26, -r * 0.5);
    ctx.lineTo(r * 0.55, 0);
    ctx.lineTo(r * 0.26, r * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // === Cockpit ===
    const cpg = ctx.createRadialGradient(r * 0.15, -r * 0.1, 0, r * 0.15, 0, r * 0.27);
    cpg.addColorStop(0, hit ? '#ffffff' : '#ddf7ff');
    cpg.addColorStop(0.5, hit ? '#bae6fd' : '#0284c7');
    cpg.addColorStop(1, hit ? '#1d4ed8' : '#011828');
    ctx.fillStyle = cpg;
    ctx.beginPath();
    ctx.ellipse(r * 0.15, 0, r * 0.27, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(r * 0.08, -r * 0.06, r * 0.1, r * 0.065, -0.35, 0, Math.PI * 2);
    ctx.fill();
  });
}

function buildBasicEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 72 : 100, (ctx, unit) => {
    const r = 15 * unit;

    if (!lite) {
      // Outer halo
      radial(ctx, r * 0.35, r * 1.82, 'rgba(124,247,255,0.44)', 'rgba(124,247,255,0)');
      // Orbital ring (tilted ellipse, drawn before body)
      ctx.save();
      ctx.rotate(-0.38);
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.55)' : 'rgba(124,247,255,0.52)';
      ctx.lineWidth = 1.5 * unit;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.5, r * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Body sphere
    const body = ctx.createRadialGradient(-r * 0.28, -r * 0.32, 0, 0, 0, r);
    body.addColorStop(0, hit ? '#ffffff' : '#b8feff');
    body.addColorStop(0.38, hit ? '#e0f2fe' : '#1ec9d6');
    body.addColorStop(0.75, hit ? '#93c5fd' : '#064e5c');
    body.addColorStop(1, hit ? '#6b7280' : '#021219');
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#1ec9d6') : body;
    ctx.strokeStyle = hit ? 'rgba(255,255,255,0.82)' : 'rgba(186,252,255,0.68)';
    ctx.lineWidth = 1.5 * unit;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      // 3 sensor pods (triangular pattern, front-facing +x)
      const sensorPositions = [
        { x: r * 0.42, y: -r * 0.42 },
        { x: r * 0.42, y: r * 0.42 },
        { x: r * 0.6, y: 0 }
      ];
      const er = r * 0.13;
      for (const pos of sensorPositions) {
        ctx.fillStyle = '#041218';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, er * 1.35, 0, Math.PI * 2);
        ctx.fill();
        const eg = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, er);
        eg.addColorStop(0, hit ? '#ffffff' : '#d0ffff');
        eg.addColorStop(0.5, hit ? '#bae6fd' : '#1ec9d6');
        eg.addColorStop(1, hit ? '#3b82f6' : '#0a5a66');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.beginPath();
        ctx.arc(pos.x + er * 0.25, pos.y - er * 0.28, er * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      // Equatorial band highlight
      ctx.save();
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = hit ? '#ffffff' : '#7cf7ff';
      ctx.lineWidth = 2.5 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.97, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      ctx.restore();
    }
  });
}

function buildFastEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 74 : 110, (ctx, unit) => {
    const r = 15 * unit;

    if (!lite) {
      // Ghost trail copies fading to the rear
      ctx.save();
      for (let k = 1; k <= 2; k++) {
        ctx.globalAlpha = 0.18 * (3 - k) / 2;
        ctx.fillStyle = hit ? '#ffffff' : '#ff5edb';
        ctx.save();
        ctx.translate(-r * k * 0.52, 0);
        ctx.scale(1 - k * 0.07, 1 - k * 0.1);
        ctx.beginPath();
        ctx.moveTo(r * 1.32, 0);
        ctx.lineTo(-r * 0.7, -r * 0.86);
        ctx.lineTo(-r * 0.22, 0);
        ctx.lineTo(-r * 0.7, r * 0.86);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // Swept rear sub-wings
      ctx.fillStyle = hit ? '#94a3b8' : '#7e1d67';
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.45)' : 'rgba(255,94,219,0.52)';
      ctx.lineWidth = 0.8 * unit;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.05, s * r * 0.52);
        ctx.lineTo(-r * 0.65, s * r * 1.1);
        ctx.lineTo(-r * 0.88, s * r * 0.82);
        ctx.lineTo(-r * 0.25, s * r * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Main body chevron
    const bodyGrad = ctx.createLinearGradient(-r * 0.9, 0, r * 1.32, 0);
    bodyGrad.addColorStop(0, hit ? '#ffffff' : '#7e1d67');
    bodyGrad.addColorStop(0.42, hit ? '#fce7f3' : '#ff5edb');
    bodyGrad.addColorStop(1, hit ? '#ffffff' : '#ffb8f0');
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#ff5edb') : bodyGrad;
    ctx.strokeStyle = hit ? 'rgba(255,255,255,0.85)' : 'rgba(255,200,240,0.72)';
    ctx.lineWidth = 1.2 * unit;
    ctx.beginPath();
    ctx.moveTo(r * 1.32, 0);
    ctx.lineTo(-r * 0.7, -r * 0.86);
    ctx.lineTo(-r * 0.22, 0);
    ctx.lineTo(-r * 0.7, r * 0.86);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      // Central spine
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.48)' : 'rgba(255,232,250,0.42)';
      ctx.lineWidth = 0.75 * unit;
      ctx.beginPath();
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(-r * 0.5, 0);
      ctx.stroke();
      // Plasma core at tail
      const cg = ctx.createRadialGradient(-r * 0.45, 0, 0, -r * 0.45, 0, r * 0.28);
      cg.addColorStop(0, hit ? '#ffffff' : '#fff7ad');
      cg.addColorStop(0.45, hit ? '#fde68a' : '#ff8cc4');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(-r * 0.45, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function buildTankEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 86 : 114, (ctx, unit) => {
    const r = 18 * unit;

    shadowBlob(ctx, r * 1.12, r * 0.32, r * 0.65);
    if (!lite) {
      radial(ctx, r * 0.5, r * 1.65, 'rgba(167,139,250,0.3)', 'rgba(167,139,250,0)');
    }

    // Outer hexagon (armor plates)
    const outerGrad = ctx.createRadialGradient(-r * 0.22, -r * 0.18, 0, 0, 0, r);
    outerGrad.addColorStop(0, hit ? '#ffffff' : '#dcd0ff');
    outerGrad.addColorStop(0.52, hit ? '#ddd6fe' : '#3a2a6e');
    outerGrad.addColorStop(1, hit ? '#a5b4fc' : '#0e0a1f');
    polygon(ctx, r, 6, Math.PI / 6);
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#a78bfa') : outerGrad;
    ctx.strokeStyle = hit ? '#ffffff' : '#c4b5fd';
    ctx.lineWidth = 2.2 * unit;
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      // Inner armor ring (rotated 15°)
      polygon(ctx, r * 0.72, 6, Math.PI / 6 + Math.PI / 12);
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.48)' : 'rgba(167,139,250,0.52)';
      ctx.lineWidth = 1.4 * unit;
      ctx.stroke();

      // Panel spokes
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.32)' : 'rgba(14,10,31,0.78)';
      ctx.lineWidth = 1.6 * unit;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + (Math.PI * 2 * i) / 6;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.stroke();

      // Bevel edge
      polygon(ctx, r * 0.88, 6, Math.PI / 6);
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.28)' : 'rgba(196,181,253,0.3)';
      ctx.lineWidth = 0.7 * unit;
      ctx.stroke();

      // Central power core
      const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.28);
      coreGrad.addColorStop(0, hit ? '#ffffff' : '#f5f3ff');
      coreGrad.addColorStop(0.45, hit ? '#c4b5fd' : '#7c3aed');
      coreGrad.addColorStop(1, hit ? '#4c1d95' : '#2e1065');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(-r * 0.07, -r * 0.07, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function buildRangedEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 78 : 112, (ctx, unit) => {
    const r = 16 * unit;

    if (!lite) {
      radial(ctx, r * 0.18, r * 1.75, 'rgba(255,209,102,0.38)', 'rgba(255,209,102,0)');

      // Solar panel arms at diamond corners (45°, 135°, 225°, 315°)
      const panelH = r * 0.72;
      const panelW = r * 0.2;
      for (let i = 0; i < 4; i++) {
        const angle = Math.PI / 4 + (Math.PI * 2 * i) / 4;
        ctx.save();
        ctx.rotate(angle);
        ctx.fillStyle = hit ? '#6b7280' : '#1a1200';
        ctx.strokeStyle = hit ? 'rgba(255,255,255,0.5)' : 'rgba(255,209,102,0.52)';
        ctx.lineWidth = 0.8 * unit;
        ctx.fillRect(r * 0.9, -panelW / 2, panelH, panelW);
        ctx.strokeRect(r * 0.9, -panelW / 2, panelH, panelW);
        // Panel cell dividers
        if (!hit) {
          ctx.strokeStyle = 'rgba(255,220,80,0.32)';
          ctx.lineWidth = 0.5 * unit;
          for (const f of [0.3, 0.6]) {
            ctx.beginPath();
            ctx.moveTo(r * 0.9 + panelH * f, -panelW / 2);
            ctx.lineTo(r * 0.9 + panelH * f, panelW / 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // Diamond body
    const bodyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    bodyGrad.addColorStop(0, hit ? '#ffffff' : '#fff3b0');
    bodyGrad.addColorStop(0.48, hit ? '#fef3c7' : '#f59e0b');
    bodyGrad.addColorStop(0.82, hit ? '#fde68a' : '#78350f');
    bodyGrad.addColorStop(1, hit ? '#a16207' : '#1c0a00');
    polygon(ctx, r, 4, Math.PI / 4);
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#ffd166') : bodyGrad;
    ctx.strokeStyle = hit ? '#ffffff' : '#fde68a';
    ctx.lineWidth = 2 * unit;
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      // Inner bevel diamond
      polygon(ctx, r * 0.7, 4, Math.PI / 4);
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.38)' : 'rgba(255,243,176,0.4)';
      ctx.lineWidth = 1 * unit;
      ctx.stroke();

      // Central targeting eye
      const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.36);
      eg.addColorStop(0, hit ? '#ffffff' : '#ffffff');
      eg.addColorStop(0.3, hit ? '#fef3c7' : '#fde68a');
      eg.addColorStop(0.7, hit ? '#fbbf24' : '#d97706');
      eg.addColorStop(1, hit ? '#92400e' : '#451a03');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2);
      ctx.fill();

      // Targeting ring + crosshair
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.52)' : 'rgba(255,235,100,0.52)';
      ctx.lineWidth = 0.95 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.42)' : 'rgba(255,243,176,0.48)';
      ctx.lineWidth = 0.65 * unit;
      const ch = r * 0.52;
      const cg2 = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-ch, 0); ctx.lineTo(-cg2, 0);
      ctx.moveTo(cg2, 0); ctx.lineTo(ch, 0);
      ctx.moveTo(0, -ch); ctx.lineTo(0, -cg2);
      ctx.moveTo(0, cg2); ctx.lineTo(0, ch);
      ctx.stroke();
    }
  });
}

function buildBossEnemy(hit = false, lite = false): SpriteAsset {
  return createSprite(lite ? 154 : 256, (ctx, unit) => {
    const r = 22 * unit;

    if (!lite) {
      // Double corona
      radial(ctx, r * 0.5, r * 1.95, 'rgba(255,51,95,0.42)', 'rgba(255,51,95,0)');
      radial(ctx, r * 0.28, r * 1.42, 'rgba(255,140,80,0.36)', 'rgba(255,51,95,0)');

      // 8 radiating spikes
      ctx.save();
      ctx.globalAlpha = 0.78;
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.rotate((Math.PI * 2 * i) / 8);
        ctx.fillStyle = hit ? '#fca5a5' : '#ff335f';
        ctx.beginPath();
        ctx.moveTo(r * 0.92, 0);
        ctx.lineTo(r * 1.42, -r * 0.11);
        ctx.lineTo(r * 1.52, 0);
        ctx.lineTo(r * 1.42, r * 0.11);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // Body sphere
    const bodyGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.22, 0, 0, 0, r);
    bodyGrad.addColorStop(0, hit ? '#ffffff' : '#ff8a8a');
    bodyGrad.addColorStop(0.38, hit ? '#fecdd3' : '#7f0d24');
    bodyGrad.addColorStop(0.72, hit ? '#fb7185' : '#2a0408');
    bodyGrad.addColorStop(1, hit ? '#e11d48' : '#0d0204');
    ctx.fillStyle = lite ? (hit ? '#ffffff' : '#ff335f') : bodyGrad;
    ctx.strokeStyle = hit ? '#ffffff' : 'rgba(255,209,102,0.62)';
    ctx.lineWidth = 3 * unit;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (!lite) {
      // Inner ring
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.28)' : 'rgba(255,120,80,0.36)';
      ctx.lineWidth = 1.5 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();

      // Rune arcs
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.22)' : 'rgba(255,209,102,0.45)';
      ctx.lineWidth = 2 * unit;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.52, 0.3, 0.3 + Math.PI * 1.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, Math.PI + 0.5, Math.PI + 0.5 + Math.PI * 0.7);
      ctx.stroke();

      // Eyes
      for (const side of [-1, 1]) {
        const ex = side * r * 0.34;
        const ey = -r * 0.14;
        ctx.fillStyle = hit ? '#ffffff' : '#fff3b0';
        ctx.beginPath();
        ctx.arc(ex, ey, r * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#18040c';
        ctx.beginPath();
        ctx.arc(ex + r * 0.02, ey + r * 0.02, r * 0.072, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(ex - r * 0.02, ey - r * 0.04, r * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
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
