// Shared, pure simulation helpers used by BOTH the solo GameEngine and the
// authoritative GameSim (server + LAN client). Keeping the spawn/curse logic in
// one place prevents the two simulations from silently drifting apart — a class
// of multiplayer-desync bug. This module must stay pure TypeScript: no canvas,
// no DOM, no module-level mutable state. All randomness flows through the
// caller-supplied `rng` so results stay deterministic and reproducible.

import type { Enemy, Viewport } from './types';
import { chooseEnemyType, spawnEnemyOutsideViewport } from './enemies';

export const MIN_SPAWN_INTERVAL = 0.26;
const ENEMY_CURSE_SCALE_PER_STACK = 0.08;
// Hard ceiling on stacked objective curses. Without it, failing every
// objective compounds into an unwinnable Act 3; with the cap plus the
// completion-driven relief below, a botched objective stings but is
// recoverable by capturing the next one.
export const MAX_CURSE_STACKS = 3;

// Scale a freshly-spawned enemy's stats by the active curse stacks. Bosses are
// immune. Returns a new enemy (does not mutate the input).
export function applyCurseToEnemy(enemy: Enemy, curseStacks: number): Enemy {
  if (curseStacks <= 0 || enemy.rank === 'boss') {
    return enemy;
  }

  const scale = 1 + curseStacks * ENEMY_CURSE_SCALE_PER_STACK;
  return {
    ...enemy,
    speed: Math.round(enemy.speed * scale),
    damage: Math.round(enemy.damage * scale)
  };
}

// Apply one fresh curse stack to every already-spawned non-boss enemy in place.
// Called when a cursed objective resolves.
export function applyCurseToExistingEnemies(enemies: Enemy[]): void {
  for (const enemy of enemies) {
    if (enemy.rank === 'boss') {
      continue;
    }

    enemy.speed = Math.round(enemy.speed * 1.08);
    enemy.damage = Math.round(enemy.damage * 1.08);
  }
}

// Inverse of applyCurseToExistingEnemies: peel one curse stack off every
// already-spawned non-boss enemy in place. Called when an objective is
// completed while curses are active (the comeback path). Rounding makes this
// an approximate — not exact — inverse, which is fine for game feel and stays
// deterministic across both sims (same shared maths, same inputs).
export function relieveCurseFromExistingEnemies(enemies: Enemy[]): void {
  for (const enemy of enemies) {
    if (enemy.rank === 'boss') {
      continue;
    }

    enemy.speed = Math.round(enemy.speed / 1.08);
    enemy.damage = Math.round(enemy.damage / 1.08);
  }
}

export interface SpawnPackOptions {
  elapsed: number;
  tier: number;
  curseStacks: number;
  viewport: Viewport;
  rng: () => number;
  currentEnemyCount: number;
  // Population ceiling. Pass Infinity for the uncapped solo engine, a finite
  // cap for the authoritative server.
  maxEnemies: number;
}

export interface SpawnPackResult {
  enemies: Enemy[];   // enemies to append to the world
  interval: number;   // seconds until the next spawn tick
}

// Compute one spawn-tick's worth of enemies. RNG consumption order is fixed
// (pack-bonus roll first, then per-enemy type + position) so both sims stay in
// lockstep when fed the same seed.
export function computeSpawnPack(options: SpawnPackOptions): SpawnPackResult {
  const { elapsed, tier, curseStacks, viewport, rng, currentEnemyCount, maxEnemies } = options;
  const interval = Math.max(MIN_SPAWN_INTERVAL, 1.35 - tier * 0.06);
  const packSize = 1 + Math.floor(tier / 2) + (rng() < Math.min(0.7, tier * 0.08) ? 1 : 0);

  const enemies: Enemy[] = [];
  let count = currentEnemyCount;

  for (let index = 0; index < packSize; index += 1) {
    if (count >= maxEnemies) {
      break;
    }
    const type = chooseEnemyType(elapsed, tier, rng);
    enemies.push(applyCurseToEnemy(spawnEnemyOutsideViewport(type, viewport, tier, rng), curseStacks));
    count += 1;
  }

  return { enemies, interval };
}
