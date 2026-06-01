import type { EvolutionId, PassiveId, UpgradeOption, WeaponId } from './types';

export interface PassiveDefinition {
  id: PassiveId;
  name: string;
  description: string;
  maxLevel: number;
}

export interface EvolutionDefinition {
  id: EvolutionId;
  name: string;
  description: string;
  weaponId: WeaponId;
  passiveId: PassiveId;
}

export const RUN_LENGTH_SECONDS = 720;

export const ELITE_SCHEDULE = [150, 330, 510, 645];
export const OBJECTIVE_SCHEDULE = [270, 480, 630];

export const PASSIVES: PassiveDefinition[] = [
  {
    id: 'cooldown-sigil',
    name: 'Cooldown Sigil',
    description: '+8% attack rate per level',
    maxLevel: 5
  },
  {
    id: 'astral-lens',
    name: 'Astral Lens',
    description: '+20 pickup radius per level',
    maxLevel: 5
  },
  {
    id: 'void-core',
    name: 'Void Core',
    description: '+10% area size per level',
    maxLevel: 5
  },
  {
    id: 'keen-fletching',
    name: 'Keen Fletching',
    description: '+12% projectile speed per level',
    maxLevel: 5
  },
  {
    id: 'comet-catalyst',
    name: 'Comet Catalyst',
    description: '+25% dash damage per level',
    maxLevel: 5
  },
  {
    id: 'stellar-drive',
    name: 'Stellar Drive',
    description: '-15% dash recharge per level',
    maxLevel: 5
  },
  {
    id: 'eclipse-momentum',
    name: 'Eclipse Momentum',
    description: '+1 dash charge',
    maxLevel: 1
  }
];

export const EVOLUTIONS: EvolutionDefinition[] = [
  {
    id: 'starfall-lance',
    name: 'Starfall Lance',
    description: 'Magic Bolt pierces harder and blooms into sparks on hit',
    weaponId: 'magic-bolt',
    passiveId: 'cooldown-sigil'
  },
  {
    id: 'gravitic-halo',
    name: 'Gravitic Halo',
    description: 'Astral Orbit grows wider, strikes faster, and slows enemies',
    weaponId: 'orbit',
    passiveId: 'astral-lens'
  },
  {
    id: 'supernova-bloom',
    name: 'Supernova Bloom',
    description: 'Area Pulse leaves a lingering damaging ring',
    weaponId: 'area-pulse',
    passiveId: 'void-core'
  },
  {
    id: 'comet-volley',
    name: 'Comet Volley',
    description: 'Piercing Arrow becomes a high-speed three-arrow fan',
    weaponId: 'piercing-arrow',
    passiveId: 'keen-fletching'
  }
];

export const STAT_UPGRADES: UpgradeOption[] = [
  {
    id: 'stat-damage',
    title: 'Sharper Spells',
    description: '+18% weapon damage',
    kind: 'stat',
    stat: 'damage'
  },
  {
    id: 'stat-attack-rate',
    title: 'Quickened Casting',
    description: '+14% attack speed',
    kind: 'stat',
    stat: 'attackRate'
  },
  {
    id: 'stat-move-speed',
    title: 'Fleet Footwork',
    description: '+10% movement speed',
    kind: 'stat',
    stat: 'moveSpeed'
  },
  {
    id: 'stat-max-health',
    title: 'Blood Ward',
    description: '+24 max health and heal for 24',
    kind: 'stat',
    stat: 'maxHealth'
  },
  {
    id: 'stat-pickup-radius',
    title: 'Gem Magnet',
    description: '+28 pickup radius',
    kind: 'stat',
    stat: 'pickupRadius'
  }
];

export const RARE_STAT_UPGRADES: UpgradeOption[] = [
  {
    id: 'rare-damage',
    title: 'Eclipse Edge',
    description: '+24% weapon damage',
    kind: 'stat',
    stat: 'damage'
  },
  {
    id: 'rare-area',
    title: 'Wide Singularity',
    description: '+18% area size',
    kind: 'stat',
    stat: 'area'
  },
  {
    id: 'rare-projectile-speed',
    title: 'Meteor Draft',
    description: '+18% projectile speed',
    kind: 'stat',
    stat: 'projectileSpeed'
  }
];
