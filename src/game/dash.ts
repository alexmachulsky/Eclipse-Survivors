import type { Player } from './types';

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
