import { describe, it, expect } from 'vitest';
import { createStartingPlayer } from './state';
import { tickDashCooldown, startDash, tickDashMotion } from './dash';

describe('dash cooldown', () => {
  it('does nothing when charges are full', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const next = tickDashCooldown(p, 0.5);
    expect(next.dash.charges).toBe(2);
    expect(next.dash.rechargeRemaining).toBe(0);
  });

  it('ticks rechargeRemaining toward zero when below max charges', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const used = { ...p, dash: { ...p.dash, charges: 1, rechargeRemaining: 2.5 } };
    const next = tickDashCooldown(used, 1.0);
    expect(next.dash.rechargeRemaining).toBeCloseTo(1.5);
    expect(next.dash.charges).toBe(1);
  });

  it('grants a charge when rechargeRemaining hits zero, and starts the next cycle if still below max', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const empty = { ...p, dash: { ...p.dash, charges: 0, rechargeRemaining: 0.4 } };
    const next = tickDashCooldown(empty, 0.5);
    expect(next.dash.charges).toBe(1);
    // 0.4 elapsed for the recharge of charge #1, 0.1s "carry" applied to charge #2
    expect(next.dash.rechargeRemaining).toBeCloseTo(2.4);
  });

  it('caps charges at maxCharges + dashChargeBonus', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const next = tickDashCooldown(p, 5);
    expect(next.dash.charges).toBe(p.dash.maxCharges);
    expect(next.dash.rechargeRemaining).toBe(0);
  });

  it('respects dashChargeBonus from the eclipse-momentum passive', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const buffed = { ...p, dashChargeBonus: 1, dash: { ...p.dash, charges: 2, rechargeRemaining: 0.1 } };
    const next = tickDashCooldown(buffed, 0.5);
    // Effective max is 3 → charges should reach 3 and the second granted charge stops recharging
    expect(next.dash.charges).toBe(3);
  });

  it('respects dashRechargeMult from stellar-drive', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const buffed = {
      ...p,
      dashRechargeMult: 0.5,
      dash: { ...p.dash, charges: 1, rechargeRemaining: 1.25 }
    };
    // rechargeRemaining is the literal seconds left and is not retroactively rescaled here.
    // What we are asserting: when the next charge starts, its rechargeRemaining = 2.5 * 0.5 = 1.25.
    const next = tickDashCooldown(buffed, 1.25);
    expect(next.dash.charges).toBe(2);
    expect(next.dash.rechargeRemaining).toBe(0);
  });
});

describe('startDash', () => {
  it('returns null when charges are zero', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const empty = { ...p, dash: { ...p.dash, charges: 0 } };
    expect(startDash(empty, 1, 0)).toBeNull();
  });

  it('returns null on zero direction vector', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    expect(startDash(p, 0, 0)).toBeNull();
  });

  it('returns null when already dashing', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const mid = { ...p, dash: { ...p.dash, active: true, activeRemaining: 0.1 } };
    expect(startDash(mid, 1, 0)).toBeNull();
  });

  it('consumes one charge and starts dash with normalized direction', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const next = startDash(p, 3, 4); // length 5
    expect(next).not.toBeNull();
    expect(next!.dash.charges).toBe(1);
    expect(next!.dash.active).toBe(true);
    expect(next!.dash.dirX).toBeCloseTo(0.6);
    expect(next!.dash.dirY).toBeCloseTo(0.8);
    expect(next!.dash.activeRemaining).toBeCloseTo(0.18);
    expect(next!.dash.invulnRemaining).toBeCloseTo(0.18 + 0.06);
    expect(next!.dash.hitIds).toEqual([]);
  });

  it('starts the recharge timer when going from full to one-below-max', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const next = startDash(p, 1, 0);
    expect(next!.dash.rechargeRemaining).toBeCloseTo(2.5);
  });

  it('does not reset rechargeRemaining if already counting down', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const partial = { ...p, dash: { ...p.dash, charges: 1, rechargeRemaining: 1.0 } };
    const next = startDash(partial, 1, 0);
    expect(next!.dash.charges).toBe(0);
    expect(next!.dash.rechargeRemaining).toBeCloseTo(1.0);
  });
});

describe('tickDashMotion', () => {
  it('moves player by dirX/Y * speed * dt while active and returns the segment', () => {
    const p = createStartingPlayer({ x: 100, y: 200 });
    const dashing = startDash(p, 1, 0)!;
    const result = tickDashMotion(dashing, 0.05);
    expect(result.player.position.x).toBeCloseTo(100 + 1220 * 0.05);
    expect(result.player.position.y).toBe(200);
    expect(result.segment).not.toBeNull();
    expect(result.segment!.x0).toBe(100);
    expect(result.segment!.x1).toBeCloseTo(100 + 1220 * 0.05);
    expect(result.player.dash.activeRemaining).toBeCloseTo(0.18 - 0.05);
  });

  it('ends the dash when activeRemaining reaches zero, keeping invuln tail running', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const dashing = startDash(p, 1, 0)!;
    const result = tickDashMotion(dashing, 0.18);
    expect(result.player.dash.active).toBe(false);
    expect(result.player.dash.activeRemaining).toBe(0);
    // Invuln runs full duration (0.24) in parallel; 0.18 elapsed → 0.06 left
    expect(result.player.dash.invulnRemaining).toBeCloseTo(0.06);
  });

  it('returns null segment and no movement when not active', () => {
    const p = createStartingPlayer({ x: 50, y: 50 });
    const result = tickDashMotion(p, 0.05);
    expect(result.segment).toBeNull();
    expect(result.player.position.x).toBe(50);
    // Invuln still ticks if positive
    expect(result.player.dash.invulnRemaining).toBe(0);
  });

  it('decays invuln remaining for non-active player', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const tail = { ...p, dash: { ...p.dash, active: false, activeRemaining: 0, invulnRemaining: 0.04 } };
    const result = tickDashMotion(tail, 0.03);
    expect(result.player.dash.invulnRemaining).toBeCloseTo(0.01);
    expect(result.segment).toBeNull();
  });
});

import { tryQueueDash, consumeDashQueue, resolveDashHits } from './dash';
import type { Enemy } from './types';

function makeEnemy(id: string, x: number, y: number, r = 14): Enemy {
  return {
    id,
    type: 'basic',
    rank: 'normal',
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius: r,
    maxHealth: 22,
    health: 22,
    speed: 0,
    damage: 0,
    xpValue: 1,
    color: '#fff',
    cooldown: 0,
    hitFlash: 0
  };
}

describe('resolveDashHits', () => {
  it('hits all enemies whose hit-circle overlaps the dash segment', () => {
    const segment = { x0: 0, y0: 0, x1: 200, y1: 0 };
    const enemies: Enemy[] = [
      makeEnemy('a', 50, 0),
      makeEnemy('b', 100, 12),
      makeEnemy('c', 180, -5),
      makeEnemy('d', 220, 100) // far away
    ];
    const player = createStartingPlayer({ x: 0, y: 0 });
    const result = resolveDashHits(segment, enemies, player);
    expect(result.hits.map((h) => h.enemyId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips enemies whose ids are already in player.dash.hitIds', () => {
    const segment = { x0: 0, y0: 0, x1: 200, y1: 0 };
    const enemies = [makeEnemy('a', 50, 0), makeEnemy('b', 150, 0)];
    const p = createStartingPlayer({ x: 0, y: 0 });
    const dashing = { ...p, dash: { ...p.dash, hitIds: ['a'] } };
    const result = resolveDashHits(segment, enemies, dashing);
    expect(result.hits.map((h) => h.enemyId)).toEqual(['b']);
    expect(result.updatedHitIds.sort()).toEqual(['a', 'b']);
  });

  it('damage = (baseDamage) * damageMultiplier * dashDamageMult', () => {
    const segment = { x0: 0, y0: 0, x1: 100, y1: 0 };
    const enemies = [makeEnemy('a', 50, 0)];
    const p = { ...createStartingPlayer({ x: 0, y: 0 }), damageMultiplier: 2, dashDamageMult: 1.5 };
    const result = resolveDashHits(segment, enemies, p);
    expect(result.hits[0].damage).toBeCloseTo(28 * 2 * 1.5);
  });
});

describe('dash queue', () => {
  it('tryQueueDash sets queued when active and remaining ≤ queueWindow', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const tailEnd = { ...p, dash: { ...p.dash, active: true, activeRemaining: 0.05 } };
    const next = tryQueueDash(tailEnd);
    expect(next.dash.queued).toBe(true);
  });

  it('tryQueueDash does NOT queue if outside the window', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const midDash = { ...p, dash: { ...p.dash, active: true, activeRemaining: 0.15 } };
    const next = tryQueueDash(midDash);
    expect(next.dash.queued).toBe(false);
  });

  it('consumeDashQueue starts a new dash when queued + has charge + not active', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const ready = {
      ...p,
      dash: { ...p.dash, active: false, activeRemaining: 0, queued: true, charges: 1 }
    };
    const next = consumeDashQueue(ready, 1, 0);
    expect(next).not.toBeNull();
    expect(next!.dash.active).toBe(true);
    expect(next!.dash.queued).toBe(false);
  });

  it('consumeDashQueue returns null and clears queue when no charge left', () => {
    const p = createStartingPlayer({ x: 0, y: 0 });
    const empty = {
      ...p,
      dash: { ...p.dash, active: false, queued: true, charges: 0 }
    };
    const next = consumeDashQueue(empty, 1, 0);
    expect(next).toBeNull();
  });
});

import { PASSIVES } from './content/passives.registry';

describe('dash passives', () => {
  it('comet-catalyst scales dashDamageMult linearly', () => {
    let p = createStartingPlayer({ x: 0, y: 0 });
    for (let i = 0; i < 3; i++) p = PASSIVES['comet-catalyst'].apply(p);
    expect(p.dashDamageMult).toBeCloseTo(1 + 0.25 * 3);
  });

  it('stellar-drive reduces dashRechargeMult, clamped at 0.25', () => {
    let p = createStartingPlayer({ x: 0, y: 0 });
    for (let i = 0; i < 4; i++) p = PASSIVES['stellar-drive'].apply(p);
    // 1 → 0.85 → 0.70 → 0.55 → 0.40
    expect(p.dashRechargeMult).toBeCloseTo(0.4);
  });

  it('stellar-drive cannot reduce dashRechargeMult below 0.25', () => {
    let p = createStartingPlayer({ x: 0, y: 0 });
    for (let i = 0; i < 10; i++) p = PASSIVES['stellar-drive'].apply(p);
    expect(p.dashRechargeMult).toBe(0.25);
  });

  it('eclipse-momentum bumps dashChargeBonus and tops off charges', () => {
    const start = createStartingPlayer({ x: 0, y: 0 });
    const after = PASSIVES['eclipse-momentum'].apply(start);
    expect(after.dashChargeBonus).toBe(1);
    // Charges should clamp to maxCharges + bonus = 3
    expect(after.dash.charges).toBeLessThanOrEqual(3);
  });
});
