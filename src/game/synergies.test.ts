import { describe, it, expect } from 'vitest';
import {
  SYNERGIES,
  weaponDamageMultiplier,
  getAvailableSynergies,
  applySynergy,
  synergyLevel
} from './synergies';
import { createStartingPlayer, createStartingWeapons } from './state';
import { fireWeaponAtTarget } from './weapons';
import { createUpgradeChoices, applyUpgrade } from './rewards';
import type { Enemy, Player, Weapon } from './types';

function player(): Player {
  return createStartingPlayer({ x: 0, y: 0 });
}

function weapon(id: string, tags: string[], over: Partial<Weapon> = {}): Weapon {
  return { id, name: id, level: 1, cooldown: 0, fireRate: 1, damage: 10, range: 100, unlocked: true, tags, ...over };
}

function def(id: string) {
  const d = SYNERGIES.find((s) => s.id === id);
  if (!d) throw new Error(`missing synergy ${id}`);
  return d;
}

describe('SYNERGIES catalog', () => {
  it('has unique ids and a positive maxLevel', () => {
    const ids = new Set<string>();
    for (const s of SYNERGIES) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.maxLevel).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('weaponDamageMultiplier', () => {
  it('returns the global damage multiplier when no tag damage is present', () => {
    const p = player();
    p.damageMultiplier = 1.5;
    expect(weaponDamageMultiplier(weapon('w', ['projectile']), p)).toBeCloseTo(1.5, 6);
  });

  it('multiplies by the tag damage of each of the weapon tags', () => {
    const p = player();
    p.damageMultiplier = 1;
    p.tagDamage = { projectile: 1.2, area: 1.5 };
    // projectile-only weapon → ×1.2
    expect(weaponDamageMultiplier(weapon('w1', ['projectile']), p)).toBeCloseTo(1.2, 6);
    // multi-tag weapon stacks both tags → ×1.2×1.5
    expect(weaponDamageMultiplier(weapon('w2', ['projectile', 'area']), p)).toBeCloseTo(1.8, 6);
    // untouched tag → ×1
    expect(weaponDamageMultiplier(weapon('w3', ['homing']), p)).toBeCloseTo(1, 6);
  });
});

describe('getAvailableSynergies', () => {
  it('offers the projectile synergy only once 2+ projectile weapons are unlocked', () => {
    const p = player();
    const oneProjectile = [weapon('magic-bolt', ['projectile'])];
    expect(getAvailableSynergies(oneProjectile, p).some((s) => s.id === 'syn-projectile')).toBe(false);

    const twoProjectiles = [weapon('magic-bolt', ['projectile']), weapon('piercing-arrow', ['projectile'])];
    expect(getAvailableSynergies(twoProjectiles, p).some((s) => s.id === 'syn-projectile')).toBe(true);
  });

  it('does not count locked weapons toward the requirement', () => {
    const p = player();
    const weapons = [weapon('magic-bolt', ['projectile']), weapon('piercing-arrow', ['projectile'], { unlocked: false })];
    expect(getAvailableSynergies(weapons, p).some((s) => s.id === 'syn-projectile')).toBe(false);
  });

  it('stops offering a synergy once it reaches its max level', () => {
    let p = player();
    const weapons = [weapon('magic-bolt', ['projectile']), weapon('piercing-arrow', ['projectile'])];
    const d = def('syn-projectile');
    for (let i = 0; i < d.maxLevel; i++) {
      expect(getAvailableSynergies(weapons, p).some((s) => s.id === 'syn-projectile')).toBe(true);
      p = applySynergy(p, 'syn-projectile');
    }
    expect(getAvailableSynergies(weapons, p).some((s) => s.id === 'syn-projectile')).toBe(false);
  });
});

describe('applySynergy', () => {
  it('raises the tag damage and records the synergy level', () => {
    const p = player();
    const after = applySynergy(p, 'syn-projectile');
    expect(synergyLevel(after, 'syn-projectile')).toBe(1);
    // Projectile weapons now hit harder than the global multiplier alone.
    expect(weaponDamageMultiplier(weapon('w', ['projectile']), after)).toBeGreaterThan(
      weaponDamageMultiplier(weapon('w', ['projectile']), p)
    );
  });

  it('does not mutate the input player', () => {
    const p = player();
    const snapshot = JSON.parse(JSON.stringify(p));
    applySynergy(p, 'syn-projectile');
    expect(p).toEqual(snapshot);
  });

  it('stacks multiplicatively across levels', () => {
    let p = player();
    p.damageMultiplier = 1;
    const before = weaponDamageMultiplier(weapon('w', ['projectile']), p);
    p = applySynergy(p, 'syn-projectile');
    const one = weaponDamageMultiplier(weapon('w', ['projectile']), p);
    p = applySynergy(p, 'syn-projectile');
    const two = weaponDamageMultiplier(weapon('w', ['projectile']), p);
    expect(one).toBeGreaterThan(before);
    expect(two).toBeGreaterThan(one);
    // second level multiplies by the same per-level factor as the first
    expect(two / one).toBeCloseTo(one / before, 5);
  });

  it('is a no-op for an unknown synergy id', () => {
    const p = player();
    expect(applySynergy(p, 'syn-bogus')).toEqual(p);
  });
});

describe('synergies integrate with real starting weapons', () => {
  it('offers the area synergy once orbit and area-pulse are both unlocked', () => {
    const p = player();
    const weapons = createStartingWeapons().map((w) =>
      w.id === 'orbit' || w.id === 'area-pulse' ? { ...w, unlocked: true, level: 3 } : w
    );
    const available = getAvailableSynergies(weapons, p);
    expect(available.some((s) => s.id === 'syn-area')).toBe(true);
  });
});

describe('synergy damage reaches the fire path', () => {
  const enemy: Enemy = {
    id: 'e1', type: 'basic', rank: 'normal',
    position: { x: 200, y: 0 }, velocity: { x: 0, y: 0 },
    radius: 16, maxHealth: 999, health: 999, speed: 0, damage: 1,
    xpValue: 1, color: '#fff', cooldown: 0, hitFlash: 0
  };

  it('a projectile weapon hits harder after Volley Doctrine is taken', () => {
    const magicBolt = createStartingWeapons().find((w) => w.id === 'magic-bolt')!;
    const before = fireWeaponAtTarget(magicBolt, player(), enemy, () => 0.5);
    const boosted = applySynergy(player(), 'syn-projectile');
    const after = fireWeaponAtTarget(magicBolt, boosted, enemy, () => 0.5);
    expect(after[0].damage).toBeGreaterThan(before[0].damage);
  });
});

describe('synergies flow through the shared upgrade roll', () => {
  function projectileLoadout(): Weapon[] {
    return createStartingWeapons().map((w) =>
      w.id === 'piercing-arrow' ? { ...w, unlocked: true } : w
    );
  }

  it('offers the projectile synergy as a level-up card once qualified', () => {
    const choices = createUpgradeChoices(player(), projectileLoadout(), () => 0.5);
    const synergy = choices.find((c) => c.kind === 'synergy');
    expect(synergy).toBeDefined();
    expect(synergy?.synergyId).toBe('syn-projectile');
    expect(synergy?.rarity).toBe('epic');
  });

  it('applyUpgrade applies the chosen synergy to the player', () => {
    const choices = createUpgradeChoices(player(), projectileLoadout(), () => 0.5);
    const synergy = choices.find((c) => c.kind === 'synergy')!;
    const { player: next } = applyUpgrade(player(), projectileLoadout(), synergy);
    expect(synergyLevel(next, 'syn-projectile')).toBe(1);
  });
});
