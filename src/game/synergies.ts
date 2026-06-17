import type { Player, Weapon } from './types';

// Synergy build-system — tag-gated "build milestone" upgrades.
//
// Survivors-likes reward committing to an archetype; a build of three
// projectile weapons should feel meaningfully different from a grab-bag of
// stat cards. Synergies make that legible: once your loadout LEANS into a
// weapon tag (projectile / area / orbit / homing) or into dash, a high-rarity
// synergy card appears that scales THAT archetype — not your global stats.
//
// The combat effect is a per-tag damage multiplier materialized onto
// `player.tagDamage`, read by `weaponDamageMultiplier` in the fire path. Every
// effect routes through the player object and the shared `applyUpgrade`, so the
// solo engine and the authoritative LAN sim stay in lockstep automatically —
// no GameSim/GameEngine duplication.
//
// Readability rule (genre research: "depth is powerful only if it's readable"):
// each card's `effectLabel` states the exact cumulative effect at the next
// level, so players can see what a build choice actually buys.

interface SynergyDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** Whether the current loadout qualifies for this synergy at all. */
  requires: (weapons: Weapon[], player: Player) => boolean;
  /** Pure: apply exactly one level of this synergy, returning a new player. */
  apply: (player: Player) => Player;
  /** Human-readable cumulative effect once the player owns `level` of it. */
  effectLabel: (level: number) => string;
}

const pct = (factor: number, level: number): number => Math.round((Math.pow(factor, level) - 1) * 100);

/** How many unlocked weapons carry `tag`. */
function unlockedWithTag(weapons: Weapon[], tag: string): number {
  return weapons.filter((w) => w.unlocked && w.tags.includes(tag)).length;
}

/** Apply one level of a per-tag-damage synergy plus an optional themed global. */
function tagSynergy(
  id: string,
  tag: string,
  damageFactor: number,
  secondary?: (player: Player) => Partial<Player>
) {
  return (player: Player): Player => {
    const base: Player = {
      ...player,
      synergies: { ...player.synergies, [id]: (player.synergies?.[id] ?? 0) + 1 },
      tagDamage: { ...player.tagDamage, [tag]: (player.tagDamage?.[tag] ?? 1) * damageFactor }
    };
    return secondary ? { ...base, ...secondary(base) } : base;
  };
}

export const SYNERGIES: SynergyDef[] = [
  {
    id: 'syn-projectile',
    name: 'Volley Doctrine',
    description: 'Your projectile weapons fire with deadly discipline.',
    maxLevel: 3,
    requires: (weapons) => unlockedWithTag(weapons, 'projectile') >= 2,
    apply: tagSynergy('syn-projectile', 'projectile', 1.22, (p) => ({
      projectileSpeedMultiplier: p.projectileSpeedMultiplier * 1.1
    })),
    effectLabel: (level) => `+${pct(1.22, level)}% projectile damage · +${pct(1.1, level)}% projectile speed`
  },
  {
    id: 'syn-area',
    name: 'Resonance Field',
    description: 'Your area weapons resonate, hitting harder over a wider zone.',
    maxLevel: 3,
    requires: (weapons) => unlockedWithTag(weapons, 'area') >= 2,
    apply: tagSynergy('syn-area', 'area', 1.24, (p) => ({
      areaMultiplier: p.areaMultiplier * 1.08
    })),
    effectLabel: (level) => `+${pct(1.24, level)}% area damage · +${pct(1.08, level)}% area size`
  },
  {
    id: 'syn-orbit',
    name: 'Orrery Protocol',
    description: 'Your orbiting blades spin faster and bite deeper.',
    maxLevel: 2,
    requires: (weapons) => weapons.some((w) => w.id === 'orbit' && w.unlocked && w.level >= 3),
    apply: tagSynergy('syn-orbit', 'orbit', 1.3, (p) => ({
      attackRateMultiplier: p.attackRateMultiplier * 1.08
    })),
    effectLabel: (level) => `+${pct(1.3, level)}% orbit damage · +${pct(1.08, level)}% attack speed`
  },
  {
    id: 'syn-homing',
    name: 'Lock-On Matrix',
    description: 'Your seekers acquire and obliterate their targets.',
    maxLevel: 2,
    requires: (weapons) => unlockedWithTag(weapons, 'homing') >= 1,
    apply: tagSynergy('syn-homing', 'homing', 1.28),
    effectLabel: (level) => `+${pct(1.28, level)}% homing damage`
  },
  {
    id: 'syn-dash',
    name: 'Kinetic Overflow',
    description: 'Your dash carries lethal momentum.',
    maxLevel: 2,
    // Gated on having invested in dash damage (the dash-damage passive bumps it > 1).
    requires: (_weapons, player) => player.dashDamageMult > 1,
    apply: (player) => ({
      ...player,
      synergies: { ...player.synergies, ['syn-dash']: (player.synergies?.['syn-dash'] ?? 0) + 1 },
      dashDamageMult: player.dashDamageMult + 0.5
    }),
    effectLabel: (level) => `+${level * 50}% dash damage`
  }
];

const SYNERGY_BY_ID: Record<string, SynergyDef> = Object.fromEntries(SYNERGIES.map((s) => [s.id, s]));

/** Owned level of a synergy (0 if never taken). */
export function synergyLevel(player: Player, id: string): number {
  return player.synergies?.[id] ?? 0;
}

/**
 * Effective damage multiplier for a weapon: the player's global damage
 * multiplier times the per-tag synergy multiplier for every tag the weapon
 * carries (a tag with no synergy contributes 1×). Defensive against players
 * that predate the field (LAN-reconstructed renderer state).
 */
export function weaponDamageMultiplier(weapon: Weapon, player: Player): number {
  let mult = player.damageMultiplier;
  const tagDamage = player.tagDamage;
  if (tagDamage) {
    for (const tag of weapon.tags) {
      mult *= tagDamage[tag] ?? 1;
    }
  }
  return mult;
}

/** Synergies whose loadout requirement is met and that are below their cap. */
export function getAvailableSynergies(weapons: Weapon[], player: Player): SynergyDef[] {
  return SYNERGIES.filter(
    (s) => synergyLevel(player, s.id) < s.maxLevel && s.requires(weapons, player)
  );
}

/** Pure: apply one level of `synergyId`; no-op for an unknown id. */
export function applySynergy(player: Player, synergyId: string): Player {
  const def = SYNERGY_BY_ID[synergyId];
  return def ? def.apply(player) : player;
}
