import type { Player, Enemy } from './types';

export const DASH_CONFIG = {
  baseDamage: 28,
  baseDuration: 0.18,
  baseSpeed: 1220,
  baseRecharge: 2.5,
  invulnTail: 0.06,
  queueWindow: 0.08
};

function effectiveMax(player: Player): number {
  return player.dash.maxCharges + (player.dashChargeBonus ?? 0);
}

function effectiveRecharge(player: Player): number {
  return player.dash.rechargeDuration * (player.dashRechargeMult ?? 1);
}

export function tickDashCooldown(player: Player, dt: number): Player {
  const max = effectiveMax(player);
  if (player.dash.charges >= max) {
    return player.dash.rechargeRemaining === 0
      ? player
      : { ...player, dash: { ...player.dash, rechargeRemaining: 0 } };
  }
  let charges = player.dash.charges;
  let remaining = player.dash.rechargeRemaining;
  if (remaining <= 0) {
    remaining = effectiveRecharge(player);
  }
  let dtLeft = dt;
  while (dtLeft > 0 && charges < max) {
    if (remaining <= dtLeft) {
      dtLeft -= remaining;
      charges += 1;
      remaining = charges < max ? effectiveRecharge(player) : 0;
    } else {
      remaining -= dtLeft;
      dtLeft = 0;
    }
  }
  if (charges >= max) {
    remaining = 0;
  }
  return { ...player, dash: { ...player.dash, charges, rechargeRemaining: remaining } };
}

export function startDash(player: Player, dirX: number, dirY: number): Player | null {
  if (player.dash.charges <= 0) return null;
  if (player.dash.active) return null;
  const len = Math.hypot(dirX, dirY);
  if (len === 0 || !Number.isFinite(len)) return null;
  const nx = dirX / len;
  const ny = dirY / len;
  const charges = player.dash.charges - 1;
  // Start recharge timer only if it's not already running
  const rechargeRemaining = player.dash.rechargeRemaining > 0
    ? player.dash.rechargeRemaining
    : effectiveRecharge(player);
  return {
    ...player,
    dash: {
      ...player.dash,
      charges,
      rechargeRemaining,
      active: true,
      activeRemaining: DASH_CONFIG.baseDuration,
      invulnRemaining: DASH_CONFIG.baseDuration + DASH_CONFIG.invulnTail,
      dirX: nx,
      dirY: ny,
      hitIds: [],
      queued: false
    }
  };
}

export interface DashSegment {
  x0: number; y0: number; x1: number; y1: number;
}

export function tickDashMotion(
  player: Player,
  dt: number
): { player: Player; segment: DashSegment | null } {
  if (!player.dash.active) {
    if (player.dash.invulnRemaining > 0) {
      const inv = Math.max(0, player.dash.invulnRemaining - dt);
      return { player: { ...player, dash: { ...player.dash, invulnRemaining: inv } }, segment: null };
    }
    return { player, segment: null };
  }
  const remaining = player.dash.activeRemaining;
  const step = Math.min(dt, remaining);
  const dx = player.dash.dirX * player.dash.speed * step;
  const dy = player.dash.dirY * player.dash.speed * step;
  const x0 = player.position.x;
  const y0 = player.position.y;
  const x1 = x0 + dx;
  const y1 = y0 + dy;
  const stillActive = remaining - step > 1e-6;
  const newRemaining = stillActive ? remaining - step : 0;
  const newInvuln = Math.max(0, player.dash.invulnRemaining - dt);
  return {
    player: {
      ...player,
      position: { x: x1, y: y1 },
      dash: {
        ...player.dash,
        active: stillActive,
        activeRemaining: newRemaining,
        invulnRemaining: newInvuln
      }
    },
    segment: { x0, y0, x1, y1 }
  };
}

export interface DashHit {
  enemyId: string;
  damage: number;
  hitX: number;
  hitY: number;
}

// Squared distance from point (px,py) to segment (x0,y0)-(x1,y1)
function pointToSegmentSq(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - x0; const ey = py - y0;
    return ex * ex + ey * ey;
  }
  let t = ((px - x0) * dx + (py - y0) * dy) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  const ex = px - cx; const ey = py - cy;
  return ex * ex + ey * ey;
}

export function resolveDashHits(
  segment: DashSegment,
  enemies: readonly Enemy[],
  player: Player
): { hits: DashHit[]; updatedHitIds: string[] } {
  const hits: DashHit[] = [];
  const already = new Set(player.dash.hitIds);
  const baseDamage = DASH_CONFIG.baseDamage * player.damageMultiplier * (player.dashDamageMult ?? 1);
  // Use player radius as a generous cushion so the comet "feels" like it brushes enemies
  const playerR = player.radius * 0.5;
  for (const e of enemies) {
    if (already.has(e.id)) continue;
    const reach = e.radius + playerR;
    const distSq = pointToSegmentSq(
      e.position.x, e.position.y,
      segment.x0, segment.y0, segment.x1, segment.y1
    );
    if (distSq <= reach * reach) {
      hits.push({ enemyId: e.id, damage: baseDamage, hitX: e.position.x, hitY: e.position.y });
      already.add(e.id);
    }
  }
  return { hits, updatedHitIds: Array.from(already) };
}

export function tryQueueDash(player: Player): Player {
  if (!player.dash.active) return player;
  if (player.dash.activeRemaining > DASH_CONFIG.queueWindow) return player;
  if (player.dash.queued) return player;
  return { ...player, dash: { ...player.dash, queued: true } };
}

export function consumeDashQueue(player: Player, dirX: number, dirY: number): Player | null {
  if (!player.dash.queued) return null;
  if (player.dash.active) return null;
  if (player.dash.charges <= 0) return null;
  return startDash(player, dirX, dirY);
}
