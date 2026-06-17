import type { Player } from './types';

// Persistent, SOLO-ONLY meta-progression: the "Star Forge".
//
// Eclipse Shards earned across runs (see wallet.ts) are spent here on modest,
// capped permanent starting bonuses. Two hard rules keep this safe:
//
//   1. SOLO ONLY. These bonuses are applied in `GameEngine.startRun()` via
//      `applyMetaUpgrades`, never in the shared `createInitialGameState` /
//      `createStartingPlayer` factories — otherwise they would leak into the
//      authoritative LAN sim (`GameSim`) and desync co-op balance.
//   2. HORIZONTAL-ISH AND CAPPED. Effects are small and tier-limited so skill
//      still dominates; the genre research (favor sidegrades, escalate costs)
//      warns against permanent power that trivializes runs.
//
// Like the wallet this is a LOCAL trust boundary — editing localStorage only
// changes your own offline progression. Never gate multiplayer on it.

export type MetaLevels = Record<string, number>;

export interface MetaUpgradeDef {
  id: string;
  name: string;
  /** Short flavor / mechanic description shown on the shop card. */
  description: string;
  /** Maximum number of purchasable tiers. */
  tiers: number;
  /** Cost in shards for each tier (length === tiers, strictly increasing). */
  costs: number[];
  /** Human-readable effect for a given owned level (e.g. "+30 max HP"). */
  effectLabel: (level: number) => string;
}

// Per-tier effect magnitudes — the balance contract, kept here as the single
// source of truth so the shop card labels and `applyMetaUpgrades` never drift.
const HULL_HP_PER_TIER = 15;
const POWER_DMG_PER_TIER = 0.04;
const THRUSTER_SPEED_PER_TIER = 0.03;
const MAGNET_RADIUS_PER_TIER = 0.12;
const DASH_CHARGE_PER_TIER = 1;
const SALVAGE_BONUS_PER_TIER = 0.08;

export const META_UPGRADES: MetaUpgradeDef[] = [
  {
    id: 'hull',
    name: 'Reinforced Hull',
    description: 'Start each run with extra maximum health.',
    tiers: 5,
    costs: [60, 110, 190, 300, 450],
    effectLabel: (level) => `+${HULL_HP_PER_TIER * level} max HP`
  },
  {
    id: 'power',
    name: 'Overcharged Core',
    description: 'All weapons deal more damage from the first second.',
    tiers: 5,
    costs: [80, 150, 260, 420, 640],
    effectLabel: (level) => `+${Math.round(POWER_DMG_PER_TIER * level * 100)}% damage`
  },
  {
    id: 'thrusters',
    name: 'Ion Thrusters',
    description: 'Move faster across the void.',
    tiers: 4,
    costs: [70, 130, 230, 360],
    effectLabel: (level) => `+${Math.round(THRUSTER_SPEED_PER_TIER * level * 100)}% move speed`
  },
  {
    id: 'magnet',
    name: 'Magnet Coil',
    description: 'Pull in shards and pickups from farther away.',
    tiers: 3,
    costs: [50, 110, 200],
    effectLabel: (level) => `+${Math.round(MAGNET_RADIUS_PER_TIER * level * 100)}% pickup radius`
  },
  {
    id: 'capacitor',
    name: 'Reserve Capacitor',
    description: 'Carry an additional dash charge into every run.',
    tiers: 1,
    costs: [350],
    effectLabel: (level) => (level > 0 ? '+1 dash charge' : 'no bonus')
  },
  {
    id: 'salvage',
    name: 'Salvage Protocol',
    description: 'Earn more shards from every solo run.',
    tiers: 3,
    costs: [120, 260, 440],
    effectLabel: (level) => `+${Math.round(SALVAGE_BONUS_PER_TIER * level * 100)}% shards earned`
  }
];

const STORAGE_KEY = 'eclipse-survivors:meta-upgrades';

const DEF_BY_ID: Record<string, MetaUpgradeDef> = Object.fromEntries(
  META_UPGRADES.map((def) => [def.id, def])
);

/** Owned tier of `id` (0 if unowned). */
export function getLevel(levels: MetaLevels, id: string): number {
  return levels[id] ?? 0;
}

/** Shard cost to buy the next tier above `level`, or null when already maxed. */
export function nextCost(def: MetaUpgradeDef, level: number): number | null {
  if (level >= def.tiers) return null;
  return def.costs[level];
}

/** Total shards sunk into the current ledger — the full refund on respec. */
export function totalSpent(levels: MetaLevels): number {
  let sum = 0;
  for (const def of META_UPGRADES) {
    const level = Math.min(def.tiers, getLevel(levels, def.id));
    for (let i = 0; i < level; i++) sum += def.costs[i];
  }
  return sum;
}

/**
 * Coerce raw (possibly tampered / corrupted) stored levels into a safe ledger:
 * known ids only, integer tiers clamped to [0, def.tiers].
 */
export function sanitizeLevels(raw: unknown): MetaLevels {
  if (!raw || typeof raw !== 'object') return {};
  const out: MetaLevels = {};
  for (const def of META_UPGRADES) {
    const value = (raw as Record<string, unknown>)[def.id];
    if (!Number.isFinite(value)) continue;
    const level = Math.min(def.tiers, Math.max(0, Math.floor(value as number)));
    if (level > 0) out[def.id] = level;
  }
  return out;
}

export function loadMetaUpgrades(): MetaLevels {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return sanitizeLevels(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveMetaUpgrades(levels: MetaLevels): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeLevels(levels)));
  } catch (err) {
    console.warn('[metaUpgrades] failed to persist meta upgrades', err);
  }
}

/**
 * Pure: return a NEW player with the owned meta bonuses applied. The input is
 * never mutated. Levels are clamped to each upgrade's tier cap defensively.
 */
export function applyMetaUpgrades(player: Player, levels: MetaLevels): Player {
  const clamp = (id: string): number => {
    const def = DEF_BY_ID[id];
    return def ? Math.min(def.tiers, Math.max(0, getLevel(levels, id))) : 0;
  };

  const next: Player = {
    ...player,
    dash: { ...player.dash }
  };

  const hull = clamp('hull');
  if (hull > 0) {
    next.maxHealth = player.maxHealth + HULL_HP_PER_TIER * hull;
    next.health = next.maxHealth;
  }

  const power = clamp('power');
  if (power > 0) {
    next.damageMultiplier = player.damageMultiplier + POWER_DMG_PER_TIER * power;
  }

  const thrusters = clamp('thrusters');
  if (thrusters > 0) {
    next.speed = player.speed * (1 + THRUSTER_SPEED_PER_TIER * thrusters);
  }

  const magnet = clamp('magnet');
  if (magnet > 0) {
    next.pickupRadius = player.pickupRadius * (1 + MAGNET_RADIUS_PER_TIER * magnet);
  }

  const capacitor = clamp('capacitor');
  if (capacitor > 0) {
    const extra = DASH_CHARGE_PER_TIER * capacitor;
    next.dash.maxCharges = player.dash.maxCharges + extra;
    next.dash.charges = player.dash.charges + extra;
  }

  return next;
}

/** Solo shard-reward multiplier from the Salvage Protocol tier (1 = no bonus). */
export function salvageMultiplier(levels: MetaLevels): number {
  const def = DEF_BY_ID['salvage'];
  const level = def ? Math.min(def.tiers, Math.max(0, getLevel(levels, 'salvage'))) : 0;
  return 1 + SALVAGE_BONUS_PER_TIER * level;
}
