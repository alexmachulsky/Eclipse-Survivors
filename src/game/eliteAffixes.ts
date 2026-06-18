import type { Enemy, EliteAffix, Telegraph, Vector } from './types';
import { angleTo } from './collisions';

// Elite affixes — shared, pure behaviour for the one telegraphed modifier each
// scheduled elite carries. Like simulation.ts this module is the single source
// of truth that keeps the solo GameEngine and the authoritative GameSim in
// lockstep: both call `tickEliteAffix`/`chooseEliteAffix`/`splitterMinions`,
// feed the same rng, and apply the returned INTENTS with their own helpers
// (addTelegraph / spawn projectile / damage players / push minions). It must
// stay pure: no canvas/DOM/window, no module-level mutable state, all
// randomness via the caller-supplied rng.
//
// Readability is the design rule (genre research: depth must be telegraphed and
// fair). Every offensive affix WINDS UP — it spawns a warning telegraph, waits,
// THEN the payload lands — so the player always sees the danger coming.

export const ELITE_AFFIXES: EliteAffix[] = ['bomber', 'sniper', 'splitter', 'haste'];

// Per-affix timing (seconds) and payload tuning. Tuned for elites scheduled at
// 150 / 330 / 510 / 645s in a 720s run — a threatening spike, not a death
// sentence.
//
// JSON-SAFETY: every timer below is finite. Affix state is serialized verbatim
// to LAN clients (server JSON.stringify), and `Infinity` round-trips to `null`,
// which would silently corrupt the timers on the renderer. The two "never
// again" cases are expressed without Infinity: `splitter` has no tick action at
// all (early-return), and `haste` is a one-shot that latches `affixSpent`.
const FIRST_DELAY: Record<EliteAffix, number> = { bomber: 2.0, sniper: 1.6, haste: 3.0, splitter: 0 };
const COOLDOWN: Record<EliteAffix, number> = { bomber: 3.4, sniper: 2.8, haste: 0, splitter: 0 };
const WINDUP: Record<EliteAffix, number> = { bomber: 0.85, sniper: 0.6, haste: 0.7, splitter: 0 };

const BOMB_RADIUS = 135;
const BOMB_DAMAGE_MULT = 1.6;
const SNIPE_SPEED = 430;
const SNIPE_DAMAGE_MULT = 1.4;
const SNIPE_LENGTH = 520;
const HASTE_SPEED_MULT = 1.5;

/** Intents an affix tick emits for the engine to apply with its own helpers. */
export type AffixIntent =
  | { kind: 'telegraph'; telegraph: Telegraph }
  | { kind: 'bomb'; position: Vector; radius: number; damage: number }
  | { kind: 'snipe'; origin: Vector; angle: number; speed: number; damage: number };

export interface AffixTickContext {
  dt: number;
  nearestPlayerPos: Vector | null;
  elapsed: number;
  rng: () => number;
}

/** Deterministically pick an affix from the catalog (consumes one rng value). */
export function chooseEliteAffix(rng: () => number): EliteAffix {
  return ELITE_AFFIXES[Math.floor(rng() * ELITE_AFFIXES.length)];
}

/** Stamp an affix onto a freshly-spawned elite and arm its first action. */
export function initEliteAffix(enemy: Enemy, affix: EliteAffix): void {
  enemy.affix = affix;
  enemy.affixCooldown = FIRST_DELAY[affix];
  enemy.affixWindup = 0;
  enemy.affixAngle = 0;
}

function affixTelegraph(enemy: Enemy, ctx: AffixTickContext): Telegraph {
  const id = `affix-${enemy.id}-${ctx.elapsed.toFixed(3)}`;
  if (enemy.affix === 'sniper') {
    return {
      id, position: { ...enemy.position }, angle: enemy.affixAngle ?? 0,
      width: 22, length: SNIPE_LENGTH, life: WINDUP.sniper, maxLife: WINDUP.sniper,
      kind: 'line', color: '#ff5d73'
    };
  }
  // bomber + haste are self-centred rings
  const radius = enemy.affix === 'bomber' ? BOMB_RADIUS : enemy.radius + 26;
  const life = WINDUP[enemy.affix ?? 'bomber'];
  return {
    id, position: { ...enemy.position }, angle: 0,
    width: 6, length: radius, life, maxLife: life,
    kind: 'ring', color: enemy.affix === 'bomber' ? '#ffa23e' : '#7be2ff'
  };
}

/**
 * Advance an elite's affix one tick. Mutates the enemy's affix timers in place
 * (consistent with the existing in-place enemy-array mutation) and returns the
 * intents the caller must apply. No-op for non-affixed / non-elite enemies.
 */
export function tickEliteAffix(enemy: Enemy, ctx: AffixTickContext): AffixIntent[] {
  // No-op for non-affixed enemies, the tick-less 'splitter' (acts only on
  // death), and any one-shot affix that has already fired ('haste').
  if (!enemy.affix || enemy.affix === 'splitter' || enemy.affixSpent) return [];
  const intents: AffixIntent[] = [];

  // Windup phase: a telegraphed action is in flight — land it when it elapses.
  if ((enemy.affixWindup ?? 0) > 0) {
    enemy.affixWindup = (enemy.affixWindup ?? 0) - ctx.dt;
    if ((enemy.affixWindup ?? 0) <= 0) {
      enemy.affixWindup = 0;
      switch (enemy.affix) {
        case 'bomber':
          intents.push({ kind: 'bomb', position: { ...enemy.position }, radius: BOMB_RADIUS, damage: Math.round(enemy.damage * BOMB_DAMAGE_MULT) });
          break;
        case 'sniper':
          intents.push({ kind: 'snipe', origin: { ...enemy.position }, angle: enemy.affixAngle ?? 0, speed: SNIPE_SPEED, damage: Math.round(enemy.damage * SNIPE_DAMAGE_MULT) });
          break;
        case 'haste':
          // One-shot enrage: a single, permanent telegraphed speed surge. Latch
          // `affixSpent` (JSON-safe) so it never re-triggers — no Infinity timer.
          enemy.speed = Math.round(enemy.speed * HASTE_SPEED_MULT);
          enemy.affixSpent = true;
          break;
      }
    }
    return intents;
  }

  // Cooldown phase: count down to the next telegraphed action.
  enemy.affixCooldown = (enemy.affixCooldown ?? 0) - ctx.dt;
  if ((enemy.affixCooldown ?? 0) <= 0) {
    if (enemy.affix === 'sniper') {
      if (!ctx.nearestPlayerPos) {
        enemy.affixCooldown = 0.3; // no target — re-check shortly
        return intents;
      }
      enemy.affixAngle = angleTo(enemy.position, ctx.nearestPlayerPos);
    }
    enemy.affixWindup = WINDUP[enemy.affix];
    enemy.affixCooldown = COOLDOWN[enemy.affix];
    intents.push({ kind: 'telegraph', telegraph: affixTelegraph(enemy, ctx) });
  }

  return intents;
}

/** Two weaker, affix-free minions spawned where a 'splitter' elite died. */
export function splitterMinions(enemy: Enemy, rng: () => number): Enemy[] {
  const maxHealth = Math.max(1, Math.round(enemy.maxHealth * 0.18));
  return Array.from({ length: 2 }, (_, i) => {
    const offset = (i === 0 ? -1 : 1) * 22;
    return {
      id: `split-${enemy.id}-${Math.floor(rng() * 1_000_000_000)}`,
      type: 'fast' as const,
      rank: 'normal' as const,
      position: { x: enemy.position.x + offset, y: enemy.position.y + offset },
      velocity: { x: 0, y: 0 },
      radius: Math.max(8, Math.round(enemy.radius * 0.55)),
      maxHealth,
      health: maxHealth,
      speed: Math.round(enemy.speed * 1.1),
      damage: Math.max(1, Math.round(enemy.damage * 0.5)),
      xpValue: Math.max(1, Math.round(enemy.xpValue * 0.25)),
      color: enemy.color,
      cooldown: 0,
      hitFlash: 0
    };
  });
}
