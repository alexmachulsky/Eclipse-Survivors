import type { GameState, Player, Vector, Weapon } from './types';
import { getXpThreshold } from './upgrades';
import { createRunDirectorState } from './runDirector';

export function createStartingPlayer(position: Vector): Player {
  return {
    position,
    radius: 16,
    maxHealth: 120,
    health: 120,
    speed: 245,
    damageMultiplier: 1,
    attackRateMultiplier: 1,
    pickupRadius: 145,
    passives: {},
    areaMultiplier: 1,
    projectileSpeedMultiplier: 1,
    invulnerableTimer: 0,
    facingAngle: 0
  };
}

export function createStartingWeapons(): Weapon[] {
  return [
    {
      id: 'magic-bolt',
      name: 'Magic Bolt',
      level: 1,
      cooldown: 0,
      fireRate: 0.62,
      damage: 16,
      range: 720,
      unlocked: true,
      tags: ['projectile']
    },
    {
      id: 'orbit',
      name: 'Astral Orbit',
      level: 0,
      cooldown: 0,
      fireRate: 0,
      damage: 10,
      range: 88,
      unlocked: false,
      tags: ['orbit', 'area']
    },
    {
      id: 'area-pulse',
      name: 'Area Pulse',
      level: 0,
      cooldown: 0,
      fireRate: 3.2,
      damage: 18,
      range: 220,
      unlocked: false,
      tags: ['area']
    },
    {
      id: 'piercing-arrow',
      name: 'Piercing Arrow',
      level: 0,
      cooldown: 0,
      fireRate: 1.35,
      damage: 19,
      range: 900,
      unlocked: false,
      tags: ['projectile']
    }
  ];
}

export function createInitialGameState(): GameState {
  const level = 1;

  return {
    phase: 'menu',
    player: createStartingPlayer({ x: 1600, y: 1200 }),
    weapons: createStartingWeapons(),
    enemies: [],
    playerProjectiles: [],
    enemyProjectiles: [],
    gems: [],
    healthPickups: [],
    particles: [],
    damageTexts: [],
    objectives: [],
    rewardChests: [],
    pendingChestChoices: [],
    enemyCurseStacks: 0,
    runDirector: createRunDirectorState(),
    telegraphs: [],
    upgradeChoices: [],
    level,
    xp: 0,
    xpToNext: getXpThreshold(level),
    elapsed: 0,
    difficultyTier: 0,
    bossSpawned: false,
    arena: { width: 3200, height: 2400 },
    stats: {
      timeSurvived: 0,
      kills: 0,
      level,
      upgradesCollected: 0,
      damageDealt: 0
    },
    orbitAngle: 0,
    screenShake: 0,
    killStreak: 0,
    killStreakExpiry: 0,
    weaponDamageDealt: {},
    upgradeHistory: [],
    cinematicState: null,
    timeScale: 1
  };
}
