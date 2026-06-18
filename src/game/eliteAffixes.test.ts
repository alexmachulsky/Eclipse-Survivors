import { describe, it, expect } from 'vitest';
import {
  ELITE_AFFIXES,
  chooseEliteAffix,
  initEliteAffix,
  tickEliteAffix,
  splitterMinions,
  type AffixIntent
} from './eliteAffixes';
import { spawnEnemyOutsideViewport } from './enemies';
import type { Enemy, EliteAffix } from './types';

const VIEWPORT = { x: 0, y: 0, width: 800, height: 600 };

function elite(affix: EliteAffix): Enemy {
  const e = spawnEnemyOutsideViewport('tank', VIEWPORT, 2, () => 0.5, 'elite');
  e.position = { x: 400, y: 300 };
  initEliteAffix(e, affix);
  return e;
}

/** Tick repeatedly until an intent of `kind` is emitted, or give up. */
function tickUntil(enemy: Enemy, kind: AffixIntent['kind'], target = { x: 700, y: 300 }): AffixIntent[] {
  for (let i = 0; i < 600; i++) {
    const intents = tickEliteAffix(enemy, { dt: 1 / 60, nearestPlayerPos: target, elapsed: i / 60, rng: () => 0.5 });
    const hit = intents.find((x) => x.kind === kind);
    if (hit) return intents;
  }
  return [];
}

describe('chooseEliteAffix', () => {
  it('returns an affix from the catalog, deterministically by rng', () => {
    expect(ELITE_AFFIXES).toContain(chooseEliteAffix(() => 0));
    expect(chooseEliteAffix(() => 0)).toBe(ELITE_AFFIXES[0]);
    expect(chooseEliteAffix(() => 0.999)).toBe(ELITE_AFFIXES[ELITE_AFFIXES.length - 1]);
  });
});

describe('initEliteAffix', () => {
  it('stamps the affix and arms a positive cooldown with no windup', () => {
    const e = elite('bomber');
    expect(e.affix).toBe('bomber');
    expect(e.affixCooldown).toBeGreaterThan(0);
    expect(e.affixWindup ?? 0).toBe(0);
  });
});

describe('tickEliteAffix — telegraph then payload', () => {
  it('does nothing for an enemy with no affix', () => {
    const plain = spawnEnemyOutsideViewport('basic', VIEWPORT, 1, () => 0.5);
    expect(tickEliteAffix(plain, { dt: 1 / 60, nearestPlayerPos: { x: 0, y: 0 }, elapsed: 0, rng: () => 0.5 })).toEqual([]);
  });

  it('sniper telegraphs a line, locks its angle, then fires along it', () => {
    const e = elite('sniper');
    const telegraphIntents = tickUntil(e, 'telegraph');
    const tele = telegraphIntents.find((x) => x.kind === 'telegraph');
    expect(tele).toBeDefined();
    if (tele?.kind === 'telegraph') expect(tele.telegraph.kind).toBe('line');
    expect(e.affixWindup).toBeGreaterThan(0);
    const lockedAngle = e.affixAngle;

    const snipeIntents = tickUntil(e, 'snipe');
    const snipe = snipeIntents.find((x) => x.kind === 'snipe');
    expect(snipe).toBeDefined();
    if (snipe?.kind === 'snipe') {
      expect(snipe.angle).toBeCloseTo(lockedAngle as number, 6);
      expect(snipe.damage).toBeGreaterThan(0);
    }
    // cooldown re-armed for the next cycle
    expect(e.affixCooldown).toBeGreaterThan(0);
  });

  it('bomber telegraphs a ring then drops an AoE at its own position', () => {
    const e = elite('bomber');
    const tIntents = tickUntil(e, 'telegraph');
    const tele = tIntents.find((x) => x.kind === 'telegraph');
    if (tele?.kind === 'telegraph') expect(tele.telegraph.kind).toBe('ring');

    const bombIntents = tickUntil(e, 'bomb');
    const bomb = bombIntents.find((x) => x.kind === 'bomb');
    expect(bomb).toBeDefined();
    if (bomb?.kind === 'bomb') {
      expect(bomb.radius).toBeGreaterThan(0);
      expect(bomb.damage).toBeGreaterThan(0);
      expect(bomb.position).toEqual(e.position);
    }
  });

  it('sniper without a target idles rather than firing', () => {
    const e = elite('sniper');
    for (let i = 0; i < 300; i++) {
      const intents = tickEliteAffix(e, { dt: 1 / 60, nearestPlayerPos: null, elapsed: i / 60, rng: () => 0.5 });
      expect(intents.some((x) => x.kind === 'snipe')).toBe(false);
    }
  });

  it('haste enrages once (a one-time speed surge) and stops re-triggering', () => {
    const e = elite('haste');
    const baseSpeed = e.speed;
    tickUntil(e, 'telegraph');
    // run well past the windup
    for (let i = 0; i < 300; i++) {
      tickEliteAffix(e, { dt: 1 / 60, nearestPlayerPos: { x: 700, y: 300 }, elapsed: i / 60, rng: () => 0.5 });
    }
    expect(e.speed).toBeGreaterThan(baseSpeed);
    // no second telegraph should ever come (one-shot enrage)
    const more = tickUntil(e, 'telegraph');
    expect(more).toEqual([]);
  });
});

describe('JSON-safety of affix state', () => {
  // Affix state is serialized verbatim to LAN clients (server JSON.stringify),
  // and `Infinity` round-trips to `null`. Every numeric affix field must stay
  // finite across the whole lifecycle so a renderer never sees a corrupt timer.
  function assertFiniteAffixState(enemy: Enemy): void {
    const round = JSON.parse(JSON.stringify(enemy)) as Enemy;
    for (const field of ['affixCooldown', 'affixWindup', 'affixAngle'] as const) {
      const value = round[field];
      if (value !== undefined) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    // affixSpent, if present, must survive as a boolean (not null/number).
    if (round.affixSpent !== undefined) {
      expect(typeof round.affixSpent).toBe('boolean');
    }
  }

  for (const affix of ELITE_AFFIXES) {
    it(`keeps ${affix} affix state finite across its full lifecycle`, () => {
      const e = elite(affix);
      assertFiniteAffixState(e);
      for (let i = 0; i < 1200; i++) {
        tickEliteAffix(e, { dt: 1 / 60, nearestPlayerPos: { x: 700, y: 300 }, elapsed: i / 60, rng: () => 0.5 });
        assertFiniteAffixState(e);
      }
    });
  }

  it('latches affixSpent (no Infinity) once haste enrages', () => {
    const e = elite('haste');
    expect(e.affixSpent ?? false).toBe(false);
    for (let i = 0; i < 600; i++) {
      tickEliteAffix(e, { dt: 1 / 60, nearestPlayerPos: { x: 700, y: 300 }, elapsed: i / 60, rng: () => 0.5 });
    }
    expect(e.affixSpent).toBe(true);
    expect(e.affixCooldown).not.toBe(Infinity);
    expect(Number.isFinite(e.affixCooldown ?? 0)).toBe(true);
  });
});

describe('splitterMinions', () => {
  it('spawns two weaker, affix-free minions at the elite', () => {
    const e = elite('splitter');
    const minions = splitterMinions(e, () => 0.5);
    expect(minions).toHaveLength(2);
    for (const m of minions) {
      expect(m.rank).toBe('normal');
      expect(m.affix).toBeUndefined();
      expect(m.maxHealth).toBeLessThan(e.maxHealth);
    }
  });
});
