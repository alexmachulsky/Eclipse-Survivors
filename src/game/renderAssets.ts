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
    // Brighter, higher-contrast cyan/blue palette so the hull reads as *lit* against the dark arena.
    const accent = hit ? '#f0f9ff' : '#9ef6ff';   // crisp silhouette rim / edge accent
    const rimLight = hit ? '#ffffff' : '#e2faff';  // hottest top-light highlight
    const hullDeep = hit ? '#1f2937' : '#0c1830';  // belly / shadow anchor (kept dark for contrast)
    const hullMid = hit ? '#52607a' : '#345da8';   // mid panel
    const hullEdge = hit ? '#aab4c4' : '#6fabf2';  // lit panel
    const hullLit = hit ? '#eef2f7' : '#bce6ff';   // top-light catch

    // === Outer glow halo — soft cyan lift so the silhouette separates from the dark background ===
    radial(ctx, r * 0.15, r * 2.0,
      hit ? 'rgba(220,235,255,0.24)' : 'rgba(95,175,255,0.30)',
      'rgba(40,80,200,0)');
    radial(ctx, r * 0.05, r * 1.2,
      hit ? 'rgba(240,250,255,0.22)' : 'rgba(140,225,255,0.28)',
      'rgba(60,130,255,0)');

    // Ground shadow — slightly offset behind to give a sense of altitude
    shadowBlob(ctx, r * 1.1, r * 0.26, r * 0.9);

    // === Swept delta wings (more aggressive sweep, sharper tips) ===
    ctx.lineJoin = 'round';
    for (const sign of [-1, 1] as const) {
      const wingGrad = ctx.createLinearGradient(0, sign * r * 0.1, 0, sign * r * 1.0);
      wingGrad.addColorStop(0, hullLit);
      wingGrad.addColorStop(0.55, hullEdge);
      wingGrad.addColorStop(1, hullMid);
      ctx.fillStyle = wingGrad;
      ctx.beginPath();
      ctx.moveTo(r * 0.42, sign * r * 0.16);          // forward wing root
      ctx.lineTo(r * 0.05, sign * r * 0.24);          // inner edge
      ctx.lineTo(-r * 0.55, sign * r * 1.02);         // sharp wing tip (further back)
      ctx.lineTo(-r * 0.18, sign * r * 0.92);         // trailing inner
      ctx.lineTo(-r * 0.05, sign * r * 0.62);         // trailing root
      ctx.closePath();
      ctx.fill();

      // Bright rim along the leading (outer) wing edge — defines the silhouette
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.85)' : 'rgba(150,240,255,0.85)';
      ctx.lineWidth = 1.1 * unit;
      ctx.beginPath();
      ctx.moveTo(r * 0.42, sign * r * 0.16);
      ctx.lineTo(r * 0.05, sign * r * 0.24);
      ctx.lineTo(-r * 0.55, sign * r * 1.02);
      ctx.stroke();

      // Wing accent stripe (cyan)
      ctx.strokeStyle = hit ? 'rgba(255,255,255,0.45)' : 'rgba(140,235,255,0.68)';
      ctx.lineWidth = 0.8 * unit;
      ctx.beginPath();
      ctx.moveTo(r * 0.25, sign * r * 0.28);
      ctx.lineTo(-r * 0.45, sign * r * 0.88);
      ctx.stroke();
    }

    // === Wing-mounted weapon hardpoints ===
    for (const sign of [-1, 1] as const) {
      const hpX = -r * 0.05;
      const hpY = sign * r * 0.55;
      // Pylon
      ctx.fillStyle = hit ? '#6b7280' : '#1a2f5a';
      ctx.strokeStyle = hit ? '#9ca3af' : '#3a6dbe';
      ctx.lineWidth = 0.5 * unit;
      ctx.beginPath();
      ctx.rect(hpX - r * 0.05, hpY - r * 0.04, r * 0.5, r * 0.08);
      ctx.fill();
      ctx.stroke();
      // Cannon barrel
      ctx.fillStyle = hit ? '#374151' : '#050a14';
      ctx.beginPath();
      ctx.rect(hpX + r * 0.18, hpY - r * 0.025, r * 0.55, r * 0.05);
      ctx.fill();
      // Barrel tip glow
      ctx.fillStyle = hit ? 'rgba(255,255,255,0.7)' : accent;
      ctx.beginPath();
      ctx.arc(hpX + r * 0.74, hpY, r * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }

    // === Wing-tip nav lights (positions; brightness animated per frame) ===
    // Port (left, sign=-1) usually red, starboard (right, sign=+1) usually green.
    // We bake a faint base disc here; the bright pulsing dot is drawn per-frame.
    for (const [sign, color] of [[-1, hit ? '#fecaca' : '#ff5b6e'], [1, hit ? '#bbf7d0' : '#5eff9c']] as const) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(-r * 0.55, sign * r * 1.02, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // === Main hull body (sharper nose, narrower waist) ===
    // Vertical gradient = top-lit fuselage → shadowed belly, giving the hull rounded dimensional form.
    const hullGrad = ctx.createLinearGradient(0, -r * 0.34, 0, r * 0.34);
    hullGrad.addColorStop(0, rimLight);
    hullGrad.addColorStop(0.28, hullLit);
    hullGrad.addColorStop(0.6, hullEdge);
    hullGrad.addColorStop(0.85, hullMid);
    hullGrad.addColorStop(1, hullDeep);
    ctx.fillStyle = hullGrad;
    ctx.beginPath();
    ctx.moveTo(r * 1.05, 0);                   // sharp nose tip
    ctx.lineTo(r * 0.7, -r * 0.18);
    ctx.lineTo(r * 0.2, -r * 0.32);
    ctx.lineTo(-r * 0.42, -r * 0.3);
    ctx.lineTo(-r * 0.7, -r * 0.16);
    ctx.lineTo(-r * 0.78, 0);
    ctx.lineTo(-r * 0.7, r * 0.16);
    ctx.lineTo(-r * 0.42, r * 0.3);
    ctx.lineTo(r * 0.2, r * 0.32);
    ctx.lineTo(r * 0.7, r * 0.18);
    ctx.closePath();
    ctx.fill();
    // Crisp bright silhouette rim around the whole hull
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.75 * unit;
    ctx.stroke();
    // Hot rim-light catching the top / nose edge
    ctx.strokeStyle = rimLight;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 0.85 * unit;
    ctx.beginPath();
    ctx.moveTo(r * 1.05, 0);
    ctx.lineTo(r * 0.7, -r * 0.18);
    ctx.lineTo(r * 0.2, -r * 0.32);
    ctx.lineTo(-r * 0.42, -r * 0.3);
    ctx.lineTo(-r * 0.7, -r * 0.16);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Inner specular highlight on hull top edge
    const specGrad = ctx.createLinearGradient(0, -r * 0.32, 0, 0);
    specGrad.addColorStop(0, hit ? 'rgba(255,255,255,0.55)' : 'rgba(190,235,255,0.5)');
    specGrad.addColorStop(1, 'rgba(160,220,255,0)');
    ctx.fillStyle = specGrad;
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.04);
    ctx.lineTo(r * 0.65, -r * 0.16);
    ctx.lineTo(r * 0.18, -r * 0.28);
    ctx.lineTo(-r * 0.4, -r * 0.26);
    ctx.lineTo(-r * 0.55, -r * 0.06);
    ctx.lineTo(-r * 0.4, -r * 0.12);
    ctx.lineTo(r * 0.18, -r * 0.18);
    ctx.lineTo(r * 0.65, -r * 0.08);
    ctx.lineTo(r * 0.95, 0);
    ctx.closePath();
    ctx.fill();

    // === Reactor seam (down center spine — base layer; bright pulse drawn per-frame) ===
    const seamGrad = ctx.createLinearGradient(-r * 0.55, 0, r * 0.85, 0);
    seamGrad.addColorStop(0, hit ? 'rgba(255,255,255,0.0)' : 'rgba(125,230,255,0)');
    seamGrad.addColorStop(0.3, hit ? 'rgba(255,255,255,0.7)' : 'rgba(150,238,255,0.9)');
    seamGrad.addColorStop(0.7, hit ? 'rgba(255,255,255,0.85)' : 'rgba(205,248,255,1)');
    seamGrad.addColorStop(1, hit ? 'rgba(255,255,255,0.0)' : 'rgba(125,230,255,0)');
    ctx.fillStyle = seamGrad;
    ctx.beginPath();
    ctx.rect(-r * 0.55, -r * 0.03, r * 1.4, r * 0.06);
    ctx.fill();

    // === Hull panel line (one clean sweep per side; finer detail just reads as noise at gameplay size) ===
    ctx.strokeStyle = hit ? 'rgba(255,255,255,0.22)' : 'rgba(150,225,255,0.4)';
    ctx.lineWidth = 0.6 * unit;
    for (const sign of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(r * 0.6, sign * r * 0.06);
      ctx.lineTo(-r * 0.5, sign * r * 0.18);
      ctx.stroke();
    }

    // === Cockpit canopy (faceted glass — 3 segments) ===
    const cpX = r * 0.36;
    const cpRx = r * 0.32;
    const cpRy = r * 0.2;

    // Canopy frame (slightly larger than glass)
    ctx.fillStyle = hit ? '#374151' : '#08152a';
    ctx.strokeStyle = hit ? 'rgba(255,255,255,0.4)' : 'rgba(125,230,255,0.5)';
    ctx.lineWidth = 0.75 * unit;
    ctx.beginPath();
    ctx.ellipse(cpX, 0, cpRx + 0.04 * r, cpRy + 0.04 * r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Canopy glass (deep blue with cyan rim)
    const cpGrad = ctx.createRadialGradient(cpX - cpRx * 0.25, -cpRy * 0.3, 0, cpX, 0, cpRx);
    cpGrad.addColorStop(0, hit ? '#ffffff' : '#d8f4ff');
    cpGrad.addColorStop(0.5, hit ? '#94a3b8' : '#2a8fcf');
    cpGrad.addColorStop(1, hit ? '#374151' : '#031024');
    ctx.fillStyle = cpGrad;
    ctx.beginPath();
    ctx.ellipse(cpX, 0, cpRx, cpRy, 0, 0, Math.PI * 2);
    ctx.fill();

    // Canopy frame ribs (vertical lines giving the glass a faceted look)
    ctx.strokeStyle = hit ? 'rgba(255,255,255,0.5)' : 'rgba(125,230,255,0.65)';
    ctx.lineWidth = 0.6 * unit;
    for (const offset of [-0.55, 0, 0.55]) {
      const ribX = cpX + cpRx * offset * 0.7;
      const ribH = cpRy * Math.sqrt(Math.max(0, 1 - (offset * 0.7) ** 2));
      ctx.beginPath();
      ctx.moveTo(ribX, -ribH);
      ctx.lineTo(ribX, ribH);
      ctx.stroke();
    }

    // Cockpit glare highlight
    ctx.fillStyle = hit ? 'rgba(255,255,255,0.6)' : 'rgba(220,245,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(cpX - cpRx * 0.22, -cpRy * 0.42, cpRx * 0.32, cpRy * 0.24, -0.45, 0, Math.PI * 2);
    ctx.fill();

    // === Main engine nozzles (rear; flicker drawn per-frame) ===
    for (const sign of [-1, 1] as const) {
      const ex = -r * 0.72;
      const ey = sign * r * 0.16;
      // Nozzle ring
      ctx.fillStyle = hit ? '#111827' : '#020714';
      ctx.strokeStyle = hit ? '#6b7280' : '#3a6dbe';
      ctx.lineWidth = 0.85 * unit;
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.12, r * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Inner core (constant base glow; per-frame layer adds throb)
      const ng = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 0.16);
      ng.addColorStop(0, hit ? 'rgba(255,255,255,0.95)' : 'rgba(160,220,255,0.95)');
      ng.addColorStop(0.55, hit ? 'rgba(200,220,255,0.5)' : 'rgba(80,160,255,0.55)');
      ng.addColorStop(1, 'rgba(40,80,200,0)');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    // === Center-rear thruster (third engine, bigger) ===
    const cex = -r * 0.78;
    ctx.fillStyle = hit ? '#111827' : '#020714';
    ctx.strokeStyle = hit ? '#9ca3af' : accent;
    ctx.lineWidth = 0.9 * unit;
    ctx.beginPath();
    ctx.ellipse(cex, 0, r * 0.14, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const ceg = ctx.createRadialGradient(cex, 0, 0, cex, 0, r * 0.18);
    ceg.addColorStop(0, hit ? 'rgba(255,255,255,1)' : 'rgba(180,235,255,1)');
    ceg.addColorStop(0.5, hit ? 'rgba(200,220,255,0.6)' : 'rgba(100,180,255,0.65)');
    ceg.addColorStop(1, 'rgba(40,80,200,0)');
    ctx.fillStyle = ceg;
    ctx.beginPath();
    ctx.arc(cex, 0, r * 0.18, 0, Math.PI * 2);
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
