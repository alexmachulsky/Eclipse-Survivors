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
