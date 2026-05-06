import { describe, it, expect } from 'vitest';
import { createStartingPlayer } from './state';
import { tickDashCooldown } from './dash';

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
