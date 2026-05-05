import type { Enemy, Player, Projectile, Weapon } from '../types';

export interface FireContext {
  weapon: Weapon;
  player: Player;
  target: Enemy;
  rng: () => number;
}

export interface WeaponDef {
  id: string;
  name: string;
  baseFireRate: number;
  baseDamage: number;
  baseRange: number;
  unlockedAtStart: boolean;
  tags: string[];
  evolutionId?: string;
  fire(ctx: FireContext): Projectile[];
}

export const WEAPONS: Record<string, WeaponDef> = {
  'magic-bolt': {
    id: 'magic-bolt',
    name: 'Magic Bolt',
    baseFireRate: 0.62,
    baseDamage: 16,
    baseRange: 720,
    unlockedAtStart: true,
    tags: ['projectile'],
    evolutionId: 'starfall-lance',
    fire: () => [],
  },
  'orbit': {
    id: 'orbit',
    name: 'Astral Orbit',
    baseFireRate: 0,
    baseDamage: 10,
    baseRange: 88,
    unlockedAtStart: false,
    tags: ['orbit', 'area'],
    evolutionId: 'gravitic-halo',
    fire: () => [],
  },
  'area-pulse': {
    id: 'area-pulse',
    name: 'Area Pulse',
    baseFireRate: 3.2,
    baseDamage: 18,
    baseRange: 220,
    unlockedAtStart: false,
    tags: ['area'],
    evolutionId: 'supernova-bloom',
    fire: () => [],
  },
  'piercing-arrow': {
    id: 'piercing-arrow',
    name: 'Piercing Arrow',
    baseFireRate: 1.35,
    baseDamage: 19,
    baseRange: 900,
    unlockedAtStart: false,
    tags: ['projectile'],
    evolutionId: 'comet-volley',
    fire: () => [],
  },
};
