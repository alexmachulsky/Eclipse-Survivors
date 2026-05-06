import type { Player } from '../types';

export interface PassiveDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  apply(player: Player): Player;
}

export const PASSIVES: Record<string, PassiveDef> = {
  'cooldown-sigil': {
    id: 'cooldown-sigil',
    name: 'Cooldown Sigil',
    description: '+8% attack rate per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, attackRateMultiplier: p.attackRateMultiplier * 1.08 }),
  },
  'astral-lens': {
    id: 'astral-lens',
    name: 'Astral Lens',
    description: '+20 pickup radius per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, pickupRadius: p.pickupRadius + 20 }),
  },
  'void-core': {
    id: 'void-core',
    name: 'Void Core',
    description: '+10% area size per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, areaMultiplier: p.areaMultiplier * 1.1 }),
  },
  'keen-fletching': {
    id: 'keen-fletching',
    name: 'Keen Fletching',
    description: '+12% projectile speed per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, projectileSpeedMultiplier: p.projectileSpeedMultiplier * 1.12 }),
  },
  'comet-catalyst': {
    id: 'comet-catalyst',
    name: 'Comet Catalyst',
    description: '+25% dash damage per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, dashDamageMult: p.dashDamageMult + 0.25 }),
  },
  'stellar-drive': {
    id: 'stellar-drive',
    name: 'Stellar Drive',
    description: '-15% dash recharge per level',
    maxLevel: 5,
    apply: (p) => ({ ...p, dashRechargeMult: Math.max(0.25, p.dashRechargeMult - 0.15) }),
  },
  'eclipse-momentum': {
    id: 'eclipse-momentum',
    name: 'Eclipse Momentum',
    description: '+1 dash charge',
    maxLevel: 1,
    apply: (p) => {
      const next = { ...p, dashChargeBonus: p.dashChargeBonus + 1 };
      // Top up current charges so the unlock feels immediate
      return { ...next, dash: { ...next.dash, charges: Math.min(next.dash.charges + 1, next.dash.maxCharges + next.dashChargeBonus) } };
    },
  },
};
