import { describe, it, expect } from 'vitest';
import {
  META_UPGRADES,
  getLevel,
  nextCost,
  totalSpent,
  sanitizeLevels,
  applyMetaUpgrades,
  salvageMultiplier,
  type MetaLevels
} from './metaUpgrades';
import { createStartingPlayer } from './state';

function defById(id: string) {
  const def = META_UPGRADES.find((d) => d.id === id);
  if (!def) throw new Error(`missing meta upgrade ${id}`);
  return def;
}

describe('META_UPGRADES catalog', () => {
  it('has unique ids and one cost per tier, with strictly increasing costs', () => {
    const ids = new Set<string>();
    for (const def of META_UPGRADES) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      expect(def.tiers).toBeGreaterThanOrEqual(1);
      expect(def.costs).toHaveLength(def.tiers);
      for (let i = 0; i < def.costs.length; i++) {
        expect(def.costs[i]).toBeGreaterThan(0);
        if (i > 0) expect(def.costs[i]).toBeGreaterThan(def.costs[i - 1]);
      }
    }
  });

  it('includes the wired upgrades hull, power, thrusters, magnet, capacitor, salvage', () => {
    for (const id of ['hull', 'power', 'thrusters', 'magnet', 'capacitor', 'salvage']) {
      expect(META_UPGRADES.some((d) => d.id === id)).toBe(true);
    }
  });
});

describe('getLevel', () => {
  it('returns 0 for an unowned upgrade and the stored level otherwise', () => {
    const levels: MetaLevels = { hull: 2 };
    expect(getLevel(levels, 'hull')).toBe(2);
    expect(getLevel(levels, 'power')).toBe(0);
  });
});

describe('nextCost', () => {
  it('returns the cost of the next tier, or null when maxed', () => {
    const hull = defById('hull');
    expect(nextCost(hull, 0)).toBe(hull.costs[0]);
    expect(nextCost(hull, 1)).toBe(hull.costs[1]);
    expect(nextCost(hull, hull.tiers)).toBeNull();
  });
});

describe('totalSpent', () => {
  it('sums the costs paid for every owned tier of every upgrade', () => {
    const hull = defById('hull');
    const power = defById('power');
    const levels: MetaLevels = { hull: 2, power: 1 };
    const expected = hull.costs[0] + hull.costs[1] + power.costs[0];
    expect(totalSpent(levels)).toBe(expected);
  });

  it('is 0 for an empty ledger', () => {
    expect(totalSpent({})).toBe(0);
  });
});

describe('sanitizeLevels', () => {
  it('clamps to [0, tiers], floors floats, and drops unknown ids', () => {
    const hull = defById('hull');
    const cleaned = sanitizeLevels({ hull: hull.tiers + 5, power: -3, thrusters: 1.9, bogus: 4 });
    expect(cleaned.hull).toBe(hull.tiers);
    expect(getLevel(cleaned, 'power')).toBe(0); // clamped non-positive levels are omitted (read as 0)
    expect(cleaned.thrusters).toBe(1);
    expect('bogus' in cleaned).toBe(false);
  });

  it('returns an empty object for non-object input', () => {
    expect(sanitizeLevels(null)).toEqual({});
    expect(sanitizeLevels('nope' as unknown)).toEqual({});
  });
});

describe('applyMetaUpgrades', () => {
  it('returns an unchanged clone when no upgrades are owned', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const out = applyMetaUpgrades(base, {});
    expect(out).toEqual(base);
  });

  it('does not mutate the input player', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const snapshot = JSON.parse(JSON.stringify(base));
    applyMetaUpgrades(base, { hull: 3, power: 2 });
    expect(base).toEqual(snapshot);
  });

  it('hull adds max health and starts the player at full health', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const out = applyMetaUpgrades(base, { hull: 2 });
    expect(out.maxHealth).toBe(base.maxHealth + 30);
    expect(out.health).toBe(out.maxHealth);
  });

  it('power raises the damage multiplier', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const out = applyMetaUpgrades(base, { power: 3 });
    expect(out.damageMultiplier).toBeCloseTo(base.damageMultiplier + 0.12, 6);
  });

  it('thrusters scale move speed multiplicatively', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const out = applyMetaUpgrades(base, { thrusters: 2 });
    expect(out.speed).toBeCloseTo(base.speed * 1.06, 6);
  });

  it('magnet scales pickup radius multiplicatively', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const out = applyMetaUpgrades(base, { magnet: 1 });
    expect(out.pickupRadius).toBeCloseTo(base.pickupRadius * 1.12, 6);
  });

  it('capacitor grants an extra dash charge', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const out = applyMetaUpgrades(base, { capacitor: 1 });
    expect(out.dash.maxCharges).toBe(base.dash.maxCharges + 1);
    expect(out.dash.charges).toBe(base.dash.charges + 1);
  });

  it('tolerates over-tier levels by clamping to the tier cap', () => {
    const base = createStartingPlayer({ x: 0, y: 0 });
    const hull = defById('hull');
    const out = applyMetaUpgrades(base, { hull: 999 });
    expect(out.maxHealth).toBe(base.maxHealth + 15 * hull.tiers);
  });
});

describe('salvageMultiplier', () => {
  it('is 1 with no salvage and rises 8% per owned tier', () => {
    expect(salvageMultiplier({})).toBeCloseTo(1, 6);
    expect(salvageMultiplier({ salvage: 2 })).toBeCloseTo(1.16, 6);
  });
});
