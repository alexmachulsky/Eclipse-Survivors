import { beforeEach, describe, expect, it } from 'vitest';
import { circlesOverlap, circlesOverlapSq, normalizeVector } from './collisions';
import { SpatialGrid } from './spatialGrid';
import { updatePlayerMovement } from './player';
import { spawnEnemyOutsideViewport, scaleEnemyStats } from './enemies';
import { getXpThreshold } from './upgrades';
import {
  applyUpgrade,
  applyEvolution,
  createChestRewardChoices,
  createUpgradeChoices,
  getEligibleEvolutions
} from './rewards';
import { createStartingPlayer, createStartingWeapons } from './state';
import { createAreaPulse, findNearestEnemy, fireWeaponAtTarget } from './weapons';
import { resolveProjectileEnemyHit } from './projectiles';
import { collectRunDirectorEvents, createRunDirectorState, getActLabel, getBossPhase, updateObjectiveProgress } from './runDirector';
import type { Enemy, ObjectiveState, PlayerRuntime, Projectile, UpgradeOption, Viewport, Weapon } from './types';
import { GameEngine } from './GameEngine';
import { GameSim, findNearestActivePlayer } from './GameSim';
import { beginFrame, beginRender, beginUpdate, endFrame, endRender, endUpdate, resetPerfForTests, summary } from './perf';
import { __resetRenderAssetsForTests, getRenderAssetStats, preloadRenderAssets } from './renderAssets';

function installCanvasStub(): { created: () => number; restore: () => void } {
  const originalDocument = globalThis.document;
  let created = 0;
  const gradient = { addColorStop: () => undefined };
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    shadowBlur: 0,
    shadowColor: '',
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    drawImage: () => undefined,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    beginPath: () => undefined,
    closePath: () => undefined,
    arc: () => undefined,
    ellipse: () => undefined,
    rect: () => undefined,
    roundRect: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    bezierCurveTo: () => undefined,
    quadraticCurveTo: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    fillText: () => undefined,
    setTransform: () => undefined
  };

  globalThis.document = {
    createElement: () => {
      created += 1;
      return {
        width: 0,
        height: 0,
        getContext: () => context
      };
    }
  } as unknown as Document;

  return {
    created: () => created,
    restore: () => {
      globalThis.document = originalDocument;
    }
  };
}

function createRecordingCanvasContext(): { context: CanvasRenderingContext2D; arcs: Array<{ x: number; y: number; radius: number; fillStyle: string }> } {
  const arcs: Array<{ x: number; y: number; radius: number; fillStyle: string }> = [];
  const gradient = { addColorStop: () => undefined };
  let fillStyle = '';
  const context = {
    globalAlpha: 1,
    strokeStyle: '',
    lineWidth: 1,
    shadowBlur: 0,
    shadowColor: '',
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof value === 'string' ? value : '[gradient]';
    },
    fillRect: () => undefined,
    drawImage: () => undefined,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    beginPath: () => undefined,
    arc: (x: number, y: number, radius: number) => {
      arcs.push({ x, y, radius, fillStyle });
    },
    ellipse: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined
  } as unknown as CanvasRenderingContext2D;

  return { context, arcs };
}

describe('core game logic', () => {
  it('targets the nearest active player and ignores choosing or downed players', () => {
    const sim = new GameSim(() => 0.5);
    const alpha = sim.addPlayer('Alpha');
    const beta = sim.addPlayer('Beta');
    const gamma = sim.addPlayer('Gamma');

    sim.startRun();
    sim.setPlayerStatus(alpha.id, 'choosing');
    sim.setPlayerStatus(gamma.id, 'downed');
    beta.player.position = { x: 900, y: 900 };

    const target = findNearestActivePlayer(sim.getState().players, { x: 880, y: 880 });

    expect(target?.id).toBe(beta.id);
  });

  it('collects XP gems for only the collecting player', () => {
    const sim = new GameSim(() => 0.5);
    const alpha = sim.addPlayer('Alpha');
    const beta = sim.addPlayer('Beta');

    sim.startRun();
    alpha.player.position = { x: 100, y: 100 };
    beta.player.position = { x: 500, y: 500 };
    sim.getState().gems.push({
      id: 'gem-test',
      position: { x: 100, y: 100 },
      value: alpha.xpToNext,
      radius: 7,
      color: '#5eead4',
      life: 0
    });

    sim.update(1 / 60);

    expect(alpha.level).toBe(2);
    expect(alpha.status).toBe('choosing');
    expect(beta.level).toBe(1);
    expect(beta.xp).toBe(0);
  });

  it('opens reward chests for only the opener', () => {
    const sim = new GameSim(() => 0.5);
    const alpha = sim.addPlayer('Alpha');
    const beta = sim.addPlayer('Beta');

    sim.startRun();
    alpha.player.position = { x: 100, y: 100 };
    beta.player.position = { x: 500, y: 500 };
    sim.getState().rewardChests.push({
      id: 'chest-test',
      position: { x: 100, y: 100 },
      radius: 18,
      source: 'elite',
      opened: false,
      life: 0
    });

    sim.update(1 / 60);

    expect(alpha.status).toBe('choosing');
    expect(alpha.pendingChestChoices).toHaveLength(3);
    expect(beta.status).toBe('active');
    expect(beta.pendingChestChoices).toHaveLength(0);
  });

  it('keeps choosing players idle, invulnerable, and untargeted while active players continue', () => {
    const sim = new GameSim(() => 0.5);
    const alpha = sim.addPlayer('Alpha');
    const beta = sim.addPlayer('Beta');

    sim.startRun();
    alpha.player.position = { x: 100, y: 100 };
    beta.player.position = { x: 300, y: 100 };
    sim.setPlayerStatus(alpha.id, 'choosing');
    sim.applyCommand({
      playerId: alpha.id,
      moveUp: false,
      moveDown: false,
      moveLeft: false,
      moveRight: true,
      aimWorldX: 600,
      aimWorldY: 100,
      reviveHeld: false,
      dashHeld: false
    });
    sim.getState().enemies.push({
      id: 'enemy-test',
      type: 'basic',
      rank: 'normal',
      position: { x: 112, y: 100 },
      velocity: { x: 0, y: 0 },
      radius: 16,
      maxHealth: 20,
      health: 20,
      speed: 0,
      damage: 999,
      xpValue: 1,
      color: '#fff',
      cooldown: 0,
      hitFlash: 0
    });

    sim.update(1 / 60);

    expect(alpha.player.position).toEqual({ x: 100, y: 100 });
    expect(alpha.player.health).toBe(alpha.player.maxHealth);
    expect(findNearestActivePlayer(sim.getState().players, { x: 100, y: 100 })?.id).toBe(beta.id);
  });

  it('revives downed players after a nearby active teammate holds revive', () => {
    const sim = new GameSim(() => 0.5);
    const alpha = sim.addPlayer('Alpha');
    const beta = sim.addPlayer('Beta');

    sim.startRun();
    alpha.status = 'downed';
    alpha.player.health = 0;
    alpha.player.position = { x: 100, y: 100 };
    beta.player.position = { x: 120, y: 100 };
    sim.applyCommand({
      playerId: beta.id,
      moveUp: false,
      moveDown: false,
      moveLeft: false,
      moveRight: false,
      aimWorldX: 120,
      aimWorldY: 100,
      reviveHeld: true,
      dashHeld: false
    });

    sim.update(3.1);

    expect(alpha.status).toBe('active');
    expect(alpha.player.health).toBeCloseTo(alpha.player.maxHealth * 0.4);
    expect(alpha.player.invulnerableTimer).toBeGreaterThan(0);
  });

  it('ends the run only when all connected non-disconnected players are downed', () => {
    const sim = new GameSim(() => 0.5);
    const alpha = sim.addPlayer('Alpha');
    const beta = sim.addPlayer('Beta');
    const gamma = sim.addPlayer('Gamma');

    sim.startRun();
    alpha.status = 'downed';
    alpha.player.health = 0;
    beta.status = 'active';
    gamma.status = 'disconnected';

    sim.update(1 / 60);
    expect(sim.getState().phase).toBe('playing');

    beta.status = 'downed';
    beta.player.health = 0;
    sim.update(1 / 60);

    expect(sim.getState().phase).toBe('gameOver');
  });

  it('summarizes rolling frame, update, and render timings', () => {
    resetPerfForTests();

    beginFrame(0);
    beginUpdate(1);
    endUpdate(3);
    beginRender(4);
    endRender(8);
    endFrame(16);

    beginFrame(16);
    beginUpdate(17);
    endUpdate(23);
    beginRender(24);
    endRender(34);
    endFrame(50);

    expect(summary()).toEqual({
      fps: 40,
      p50Frame: 34,
      p95Frame: 34,
      updateP50: 6,
      updateP95: 6,
      renderP50: 10,
      renderP95: 10
    });
  });

  it('preloads cached render sprites once and reuses them across viewport resizes', () => {
    const canvasStub = installCanvasStub();

    try {
      __resetRenderAssetsForTests();
      const assets = preloadRenderAssets();
      const createdAfterPreload = canvasStub.created();

      expect(assets.player.image).toBeDefined();
      expect(assets.enemies.basic.normal.image).toBeDefined();
      expect(getRenderAssetStats().builds).toBe(1);
      expect(createdAfterPreload).toBeGreaterThan(8);

      const engine = new GameEngine(() => 0.5);
      engine.setViewSize(1280, 800);
      engine.preloadRenderAssets();
      engine.setViewSize(390, 844);
      engine.preloadRenderAssets();

      expect(preloadRenderAssets()).toBe(assets);
      expect(getRenderAssetStats().builds).toBe(1);
      expect(canvasStub.created()).toBe(createdAfterPreload + 3);
    } finally {
      __resetRenderAssetsForTests();
      canvasStub.restore();
    }
  });

  it('does not draw a player color marker above the ship', () => {
    const canvasStub = installCanvasStub();
    const engine = new GameEngine(() => 0.5) as unknown as {
      drawRuntimePlayer: (ctx: CanvasRenderingContext2D, runtime: PlayerRuntime) => void;
      fastRender: boolean;
    };
    const player = createStartingPlayer({ x: 100, y: 100 });
    const runtime: PlayerRuntime = {
      id: 'solo',
      name: 'Player',
      color: '#5eead4',
      status: 'active',
      player,
      weapons: createStartingWeapons(),
      level: 1,
      xp: 0,
      xpToNext: getXpThreshold(1),
      upgradeChoices: [],
      pendingChestChoices: [],
      stats: {
        timeSurvived: 0,
        kills: 0,
        level: 1,
        upgradesCollected: 0,
        damageDealt: 0
      },
      reviveProgress: 0
    };
    const recording = createRecordingCanvasContext();

    try {
      engine.fastRender = true;
      engine.drawRuntimePlayer(recording.context, runtime);

      expect(recording.arcs).not.toContainEqual({
        x: 0,
        y: -player.radius * 2.65,
        radius: 5,
        fillStyle: runtime.color
      });

      // ...and the breathing glow halo that replaced it IS drawn: a
      // gradient-filled arc at the ship origin. glowScale defaults to 1 and the
      // runtime is active, so the halo branch runs even under fastRender. If the
      // halo were accidentally removed this assertion fails.
      expect(
        recording.arcs.some(
          (arc) => arc.x === 0 && arc.y === 0 && arc.radius > 0 && arc.fillStyle === '[gradient]'
        )
      ).toBe(true);
    } finally {
      __resetRenderAssetsForTests();
      canvasStub.restore();
    }
  });

  it('fires non-boss ranged enemy shots at the tuned speed (130) and radius (8)', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      update: (dt: number) => void;
      spawnTimer: number;
      state: { player: { position: { x: number; y: number } }; enemies: Enemy[]; enemyProjectiles: Projectile[] };
    };

    engine.startRun();
    engine.spawnTimer = Number.POSITIVE_INFINITY;
    const origin = engine.state.player.position;
    engine.state.enemies.push({
      id: 'ranged-test',
      type: 'ranged',
      rank: 'normal',
      position: { x: origin.x + 180, y: origin.y },
      velocity: { x: 0, y: 0 },
      radius: 14,
      maxHealth: 30,
      health: 30,
      speed: 0,
      damage: 7,
      xpValue: 3,
      color: '#ffd166',
      cooldown: 0,
      hitFlash: 0
    });

    engine.update(1 / 60);

    const shot = engine.state.enemyProjectiles.find((projectile) => projectile.owner === 'enemy');
    expect(shot).toBeDefined();
    expect(Math.hypot(shot!.velocity.x, shot!.velocity.y)).toBeCloseTo(130, 4);
    expect(shot!.radius).toBe(8);
  });

  it('fires non-boss ranged enemy shots at the same tuned speed/radius in GameSim (engine parity)', () => {
    const sim = new GameSim(() => 0.5);
    const runtime = sim.addPlayer('Solo');
    sim.startRun();
    runtime.status = 'active';
    runtime.player.position = { x: 1000, y: 1000 };
    sim.getState().enemies.push({
      id: 'ranged-test',
      type: 'ranged',
      rank: 'normal',
      position: { x: 1180, y: 1000 },
      velocity: { x: 0, y: 0 },
      radius: 14,
      maxHealth: 30,
      health: 30,
      speed: 0,
      damage: 7,
      xpValue: 3,
      color: '#ffd166',
      cooldown: 0,
      hitFlash: 0
    });

    sim.update(1 / 60);

    const shot = sim
      .getState()
      .enemyProjectiles.find((projectile) => projectile.id.startsWith('enemy-shot-ranged-test'));
    expect(shot).toBeDefined();
    expect(Math.hypot(shot!.velocity.x, shot!.velocity.y)).toBeCloseTo(130, 4);
    expect(shot!.radius).toBe(8);
  });

  it('collects gems out to 3.2x the gem radius (enlarged pickup hitbox)', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      update: (dt: number) => void;
      spawnTimer: number;
      state: {
        player: { position: { x: number; y: number }; radius: number; pickupRadius: number };
        gems: Array<{ id: string; position: { x: number; y: number }; value: number; radius: number; color: string; life: number }>;
        xp: number;
      };
    };

    engine.startRun();
    engine.spawnTimer = Number.POSITIVE_INFINITY;
    const player = engine.state.player;
    const collectRadius = player.radius + player.pickupRadius * 0.16;
    const gemRadius = 7;
    // Distance sits between the old (1x) and new (3.2x) collection thresholds:
    // not collectible with `gem.radius`, collectible with `gem.radius * 3.2`.
    const distance = collectRadius + gemRadius * 2.5;
    engine.state.gems.push({
      id: 'gem-test',
      position: { x: player.position.x + distance, y: player.position.y },
      value: 1,
      radius: gemRadius,
      color: '#5eead4',
      life: 0
    });

    // Tiny dt so the magnet barely nudges the gem (~0.7px): the collection
    // check — not the magnet pull — is what decides the outcome this frame.
    engine.update(0.001);

    expect(engine.state.gems).toHaveLength(0);
    expect(engine.state.xp).toBeGreaterThanOrEqual(1);
  });

  it('keeps squared-distance nearest targeting behavior compatible with previous range semantics', () => {
    const origin = { x: 0, y: 0 };
    const enemies: Enemy[] = [
      {
        id: 'outside',
        type: 'basic',
        rank: 'normal',
        position: { x: 101, y: 0 },
        velocity: { x: 0, y: 0 },
        radius: 16,
        maxHealth: 20,
        health: 20,
        speed: 80,
        damage: 8,
        xpValue: 1,
        color: '#fff',
        cooldown: 0,
        hitFlash: 0
      },
      {
        id: 'inside-later-tie',
        type: 'basic',
        rank: 'normal',
        position: { x: 60, y: 80 },
        velocity: { x: 0, y: 0 },
        radius: 16,
        maxHealth: 20,
        health: 20,
        speed: 80,
        damage: 8,
        xpValue: 1,
        color: '#fff',
        cooldown: 0,
        hitFlash: 0
      },
      {
        id: 'nearest',
        type: 'fast',
        rank: 'normal',
        position: { x: 30, y: 40 },
        velocity: { x: 0, y: 0 },
        radius: 12,
        maxHealth: 12,
        health: 12,
        speed: 160,
        damage: 8,
        xpValue: 1,
        color: '#fff',
        cooldown: 0,
        hitFlash: 0
      }
    ];

    expect(findNearestEnemy(enemies, origin, 100)?.id).toBe('nearest');
    expect(findNearestEnemy(enemies, origin, 49)).toBeUndefined();
  });

  it('normalizes diagonal player movement so it is not faster than straight movement', () => {
    const player = createStartingPlayer({ x: 500, y: 500 });

    const straight = updatePlayerMovement(player, { up: true, down: false, left: false, right: false }, 1, {
      width: 1000,
      height: 1000
    });
    const diagonal = updatePlayerMovement(player, { up: true, down: false, left: false, right: true }, 1, {
      width: 1000,
      height: 1000
    });

    const straightDistance = Math.hypot(straight.position.x - 500, straight.position.y - 500);
    const diagonalDistance = Math.hypot(diagonal.position.x - 500, diagonal.position.y - 500);

    expect(diagonalDistance).toBeCloseTo(straightDistance, 4);
  });

  it('spawns enemies outside the active viewport and scales them by difficulty tier', () => {
    const viewport: Viewport = { x: 100, y: 100, width: 800, height: 600 };
    const enemy = spawnEnemyOutsideViewport('tank', viewport, 3, () => 0.25);

    expect(enemy.position.x < viewport.x || enemy.position.x > viewport.x + viewport.width || enemy.position.y < viewport.y || enemy.position.y > viewport.y + viewport.height).toBe(true);

    const base = scaleEnemyStats('basic', 0);
    const scaled = scaleEnemyStats('basic', 4);

    expect(scaled.maxHealth).toBeGreaterThan(base.maxHealth);
    expect(scaled.damage).toBeGreaterThan(base.damage);
  });

  it('builds upgrade choices from locked weapons and stat upgrades, then applies them', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapons = createStartingWeapons();
    const choices = createUpgradeChoices(player, weapons, () => 0.8);

    expect(choices).toHaveLength(3);
    expect(choices.some((choice) => choice.kind === 'weapon')).toBe(true);

    const weaponChoice = choices.find((choice) => choice.kind === 'weapon');
    expect(weaponChoice).toBeDefined();

    const upgraded = applyUpgrade(player, weapons, weaponChoice!);
    expect(upgraded.weapons.some((weapon) => weapon.id === weaponChoice!.weaponId)).toBe(true);
  });

  it('includes passive choices and applies passive stat scaling', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapons = createStartingWeapons();
    const choices = createUpgradeChoices(player, weapons, () => 0.2);

    expect(choices.some((choice) => choice.kind === 'passive')).toBe(true);

    const upgraded = applyUpgrade(player, weapons, {
      id: 'passive-cooldown-sigil',
      title: 'Cooldown Sigil',
      description: '+8% attack rate',
      kind: 'passive',
      passiveId: 'cooldown-sigil'
    });

    expect(upgraded.player.passives['cooldown-sigil']).toBe(1);
    expect(upgraded.player.attackRateMultiplier).toBeCloseTo(1.08);
  });

  it('requires level 6 weapon and level 2 matching passive before offering evolutions', () => {
    const player = {
      ...createStartingPlayer({ x: 0, y: 0 }),
      passives: { 'cooldown-sigil': 1 }
    };
    const weapons = createStartingWeapons().map((weapon) =>
      weapon.id === 'magic-bolt' ? { ...weapon, level: 6, unlocked: true } : weapon
    );

    expect(getEligibleEvolutions(player, weapons)).toHaveLength(0);

    const eligiblePlayer = { ...player, passives: { 'cooldown-sigil': 2 } };
    const eligible = getEligibleEvolutions(eligiblePlayer, weapons);

    expect(eligible.map((evolution) => evolution.id)).toEqual(['starfall-lance']);
  });

  it('prioritizes eligible evolutions in chest rewards and prevents duplicates after evolving', () => {
    const player = {
      ...createStartingPlayer({ x: 0, y: 0 }),
      passives: { 'cooldown-sigil': 2 }
    };
    const weapons = createStartingWeapons().map((weapon) =>
      weapon.id === 'magic-bolt' ? { ...weapon, level: 6, unlocked: true } : weapon
    );
    const choices = createChestRewardChoices(player, weapons, () => 0.9);

    expect(choices[0].kind).toBe('evolution');
    expect(choices[0].evolutionId).toBe('starfall-lance');

    const evolved = applyEvolution(weapons, 'starfall-lance');
    expect(evolved.find((weapon) => weapon.id === 'magic-bolt')?.evolved).toBe(true);
    expect(createChestRewardChoices(player, evolved, () => 0.9).some((choice) => choice.evolutionId === 'starfall-lance')).toBe(false);
  });

  it('creates aimed weapon projectiles with damage and piercing behavior', () => {
    const player = createStartingPlayer({ x: 100, y: 100 });
    const target: Enemy = {
      id: 'target',
      type: 'basic',
      rank: 'normal',
      position: { x: 200, y: 100 },
      velocity: { x: 0, y: 0 },
      radius: 18,
      maxHealth: 24,
      health: 24,
      speed: 60,
      damage: 8,
      xpValue: 2,
      color: '#fff',
      cooldown: 0,
      hitFlash: 0
    };
    const piercingArrow: Weapon = {
      id: 'piercing-arrow',
      name: 'Piercing Arrow',
      level: 2,
      cooldown: 0,
      fireRate: 1.2,
      damage: 18,
      range: 800,
      unlocked: true,
      tags: ['projectile']
    };

    const projectiles = fireWeaponAtTarget(piercingArrow, player, target);

    expect(projectiles).toHaveLength(1);
    expect(projectiles[0].velocity.x).toBeGreaterThan(0);
    expect(projectiles[0].pierce).toBeGreaterThan(1);
  });

  it('creates deterministic evolved weapon projectile patterns', () => {
    const player = {
      ...createStartingPlayer({ x: 100, y: 100 }),
      projectileSpeedMultiplier: 1.2,
      areaMultiplier: 1.1
    };
    const target: Enemy = {
      id: 'target',
      type: 'basic',
      rank: 'normal',
      position: { x: 200, y: 100 },
      velocity: { x: 0, y: 0 },
      radius: 18,
      maxHealth: 24,
      health: 24,
      speed: 60,
      damage: 8,
      xpValue: 2,
      color: '#fff',
      cooldown: 0,
      hitFlash: 0
    };
    const arrow: Weapon = {
      id: 'piercing-arrow',
      name: 'Piercing Arrow',
      level: 6,
      cooldown: 0,
      fireRate: 1.2,
      damage: 18,
      range: 800,
      unlocked: true,
      evolved: true,
      evolutionId: 'comet-volley',
      tags: ['projectile']
    };

    const arrows = fireWeaponAtTarget(arrow, player, target);
    expect(arrows).toHaveLength(3);
    expect(arrows.map((projectile) => projectile.kind)).toEqual(['arrow', 'arrow', 'arrow']);
    expect(arrows[1].velocity.x).toBeCloseTo(792);

    const pulse = createAreaPulse({
      id: 'area-pulse',
      name: 'Area Pulse',
      level: 6,
      cooldown: 0,
      fireRate: 3.2,
      damage: 18,
      range: 220,
      unlocked: true,
      evolved: true,
      evolutionId: 'supernova-bloom',
      tags: ['area']
    }, player);
    expect(pulse.kind).toBe('pulse');
    expect(pulse.life).toBeGreaterThan(2);
  });

  it('resolves projectile hits by damaging enemies and consuming pierce count', () => {
    const enemy: Enemy = {
      id: 'enemy',
      type: 'basic',
      rank: 'normal',
      position: { x: 50, y: 50 },
      velocity: { x: 0, y: 0 },
      radius: 16,
      maxHealth: 20,
      health: 20,
      speed: 80,
      damage: 8,
      xpValue: 1,
      color: '#fff',
      cooldown: 0,
      hitFlash: 0
    };
    const projectile: Projectile = {
      id: 'projectile',
      owner: 'player',
      kind: 'bolt',
      position: { x: 50, y: 50 },
      velocity: { x: 0, y: 0 },
      radius: 6,
      damage: 12,
      life: 1,
      maxLife: 1,
      pierce: 1,
      color: '#fff'
    };

    const result = resolveProjectileEnemyHit(projectile, enemy);

    expect(result.enemy.health).toBe(8);
    expect(result.projectile.pierce).toBe(0);
    expect(result.damageText.amount).toBe(12);
  });

  it('keeps collision and XP threshold helpers deterministic', () => {
    expect(normalizeVector({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(circlesOverlap({ x: 0, y: 0 }, 10, { x: 15, y: 0 }, 6)).toBe(true);
    expect(circlesOverlapSq({ x: 0, y: 0 }, 10, { x: 17, y: 0 }, 6)).toBe(false);
    expect(getXpThreshold(5)).toBeGreaterThan(getXpThreshold(1));
  });

  it('schedules elites, objectives, and boss timing through the run director', () => {
    const director = createRunDirectorState();

    expect(collectRunDirectorEvents(director, 149.9, 150)).toEqual([{ type: 'elite', scheduledAt: 150 }]);
    expect(collectRunDirectorEvents(director, 269.9, 270)).toEqual([{ type: 'objective', scheduledAt: 270 }]);
    expect(collectRunDirectorEvents(director, 719.9, 720)).toEqual([{ type: 'boss', scheduledAt: 720 }]);
    expect(getActLabel(30)).toBe('Act 1');
    expect(getActLabel(300)).toBe('Act 2');
    expect(getActLabel(600)).toBe('Act 3');
  });

  it('updates rift objectives for completion and ignored curses', () => {
    const objective: ObjectiveState = {
      id: 'rift-1',
      position: { x: 100, y: 100 },
      radius: 72,
      spawnedAt: 0,
      captureProgress: 0,
      requiredCapture: 15,
      ignoreAfter: 45,
      state: 'active'
    };

    const captured = updateObjectiveProgress([objective], { x: 100, y: 100 }, 15);
    expect(captured.objectives[0].state).toBe('completed');
    expect(captured.completedIds).toEqual(['rift-1']);
    expect(captured.cursedIds).toEqual([]);

    const ignored = updateObjectiveProgress([{ ...objective, captureProgress: 0, state: 'active' }], { x: 400, y: 400 }, 45.1);
    expect(ignored.objectives[0].state).toBe('cursed');
    expect(ignored.cursedIds).toEqual(['rift-1']);
  });

  it('selects boss phases by health thresholds', () => {
    expect(getBossPhase(0.9)).toBe(1);
    expect(getBossPhase(0.5)).toBe(2);
    expect(getBossPhase(0.2)).toBe(3);
  });

  it('queries spatial grid candidates that match brute-force circle bounds', () => {
    const grid = new SpatialGrid(96);
    const enemies = [
      { position: { x: 50, y: 50 }, radius: 16 },
      { position: { x: 130, y: 80 }, radius: 18 },
      { position: { x: 450, y: 450 }, radius: 20 },
      { position: { x: 96, y: 220 }, radius: 14 }
    ];

    for (let index = 0; index < enemies.length; index += 1) {
      const enemy = enemies[index];
      grid.insert(index, enemy.position.x, enemy.position.y, enemy.radius);
    }

    const query = { x: 95, y: 70, radius: 42 };
    const candidates = [...new Set(grid.query(query.x, query.y, query.radius))].sort((a, b) => a - b);
    const bruteForceCells = enemies
      .map((enemy, index) => ({ enemy, index }))
      .filter(({ enemy }) => Math.abs(enemy.position.x - query.x) <= enemy.radius + query.radius && Math.abs(enemy.position.y - query.y) <= enemy.radius + query.radius)
      .map(({ index }) => index);

    expect(candidates).toEqual(bruteForceCells);
  });

  it('keeps baked render layers across viewport resizes', () => {
    const canvasStub = installCanvasStub();
    const engine = new GameEngine(() => 0.5) as unknown as {
      setViewSize: (width: number, height: number) => void;
      ensureCosmic: () => unknown;
    };

    try {
      engine.setViewSize(1280, 800);
      const firstLayers = engine.ensureCosmic();
      expect(canvasStub.created()).toBe(3);

      engine.setViewSize(390, 844);
      const secondLayers = engine.ensureCosmic();

      expect(secondLayers).toBe(firstLayers);
      expect(canvasStub.created()).toBe(3);
    } finally {
      canvasStub.restore();
    }
  });

  it('preloads baked render layers once before the animation loop', () => {
    const canvasStub = installCanvasStub();
    const engine = new GameEngine(() => 0.5) as unknown as {
      setViewSize: (width: number, height: number) => void;
      preloadRenderAssets: () => void;
    };

    try {
      __resetRenderAssetsForTests();
      engine.setViewSize(1280, 800);
      engine.preloadRenderAssets();
      const createdAfterFirstPreload = canvasStub.created();
      engine.preloadRenderAssets();

      expect(createdAfterFirstPreload).toBeGreaterThan(8);
      expect(canvasStub.created()).toBe(createdAfterFirstPreload);
    } finally {
      __resetRenderAssetsForTests();
      canvasStub.restore();
    }
  });

  it('reuses cached gradients so gradient creation does not scale with enemy count', () => {
    const canvasStub = installCanvasStub();

    function makeCountingCtx() {
      const counts = { linear: 0, radial: 0 };
      const gradient = { addColorStop: () => undefined };
      let shadowBlur = 0;
      const ctx = {
        globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', globalCompositeOperation: '', shadowColor: '',
        get shadowBlur() { return shadowBlur; }, set shadowBlur(v: number) { shadowBlur = v; },
        clearRect: () => undefined, fillRect: () => undefined, strokeRect: () => undefined, drawImage: () => undefined,
        createRadialGradient: () => { counts.radial += 1; return gradient; },
        createLinearGradient: () => { counts.linear += 1; return gradient; },
        beginPath: () => undefined, closePath: () => undefined, arc: () => undefined, ellipse: () => undefined,
        rect: () => undefined, roundRect: () => undefined, fill: () => undefined, stroke: () => undefined,
        moveTo: () => undefined, lineTo: () => undefined, bezierCurveTo: () => undefined, quadraticCurveTo: () => undefined,
        save: () => undefined, restore: () => undefined, translate: () => undefined, rotate: () => undefined, scale: () => undefined,
        fillText: () => undefined, strokeText: () => undefined, setTransform: () => undefined, setLineDash: () => undefined,
        measureText: () => ({ width: 10 }), createPattern: () => null
      } as unknown as CanvasRenderingContext2D;
      return { ctx, counts };
    }

    const engine = new GameEngine(() => 0.5) as unknown as {
      setViewSize: (w: number, h: number) => void;
      preloadRenderAssets: () => void;
      startRun: () => void;
      render: (ctx: CanvasRenderingContext2D) => void;
      state: { enemies: Enemy[]; player: { position: { x: number; y: number } } };
    };

    try {
      __resetRenderAssetsForTests();
      engine.setViewSize(1280, 720);
      engine.preloadRenderAssets();
      engine.startRun();
      const center = engine.state.player.position;
      const viewport: Viewport = { x: center.x - 640, y: center.y - 360, width: 1280, height: 720 };

      const fillView = (n: number) => {
        engine.state.enemies.length = 0;
        for (let i = 0; i < n; i++) {
          const enemy = spawnEnemyOutsideViewport('basic', viewport, 1, () => 0.5);
          enemy.id = `vis-${i}`;
          // Reposition inside the viewport so it is drawn, and damage it so the
          // health bar (the per-enemy gradient) renders.
          enemy.position = { x: center.x + ((i % 20) - 10) * 28, y: center.y + (Math.floor(i / 20) - 5) * 28 };
          enemy.health = enemy.maxHealth * 0.5;
          engine.state.enemies.push(enemy);
        }
      };

      const { ctx, counts } = makeCountingCtx();

      // First render builds the cache for this context; measure the steady frame after.
      fillView(20);
      engine.render(ctx);
      counts.linear = 0; counts.radial = 0;
      engine.render(ctx);
      const small = counts.linear + counts.radial;

      fillView(120);
      counts.linear = 0; counts.radial = 0;
      engine.render(ctx);
      const large = counts.linear + counts.radial;

      // 6x more enemies must not create more gradients: they share cached ones.
      expect(large).toBeLessThanOrEqual(small);
      expect(large).toBeLessThan(8);
    } finally {
      __resetRenderAssetsForTests();
      canvasStub.restore();
    }
  });

  it('spawns timed health pickups every 10 to 20 seconds and heals between 5 and 10 without exceeding max health', () => {
    const engine = new GameEngine(() => 0.999) as unknown as {
      setViewSize: (width: number, height: number) => void;
      startRun: () => void;
      update: (dt: number) => void;
      spawnTimer: number;
      state: {
        phase: string;
        player: { position: { x: number; y: number }; health: number; maxHealth: number };
        healthPickups: Array<{ position: { x: number; y: number }; heal: number }>;
      };
    };

    engine.setViewSize(800, 600);
    engine.startRun();
    engine.spawnTimer = Number.POSITIVE_INFINITY;
    engine.state.player.health = engine.state.player.maxHealth - 2;

    for (let frame = 0; frame < 20 * 60; frame += 1) {
      engine.update(1 / 60);
    }

    expect(engine.state.healthPickups).toHaveLength(1);
    expect(engine.state.healthPickups[0].heal).toBeGreaterThanOrEqual(5);
    expect(engine.state.healthPickups[0].heal).toBeLessThanOrEqual(10);

    engine.state.healthPickups[0].position = { ...engine.state.player.position };
    engine.update(1 / 60);

    expect(engine.state.healthPickups).toHaveLength(0);
    expect(engine.state.player.health).toBe(engine.state.player.maxHealth);
  });

  it('starts the Night Lich encounter at 12 minutes', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      update: (dt: number) => void;
      spawnTimer: number;
      state: {
        elapsed: number;
        bossSpawned: boolean;
        enemies: Enemy[];
      };
    };

    engine.startRun();
    engine.spawnTimer = Number.POSITIVE_INFINITY;
    engine.state.elapsed = 719.99;
    engine.update(0.03);

    expect(engine.state.bossSpawned).toBe(true);
    expect(engine.state.enemies.some((enemy) => enemy.type === 'boss' && enemy.rank === 'boss')).toBe(true);
  });

  it('drops exactly one reward chest when an elite dies', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      update: (dt: number) => void;
      spawnTimer: number;
      state: {
        enemies: Enemy[];
        rewardChests: Array<{ source: string }>;
      };
    };

    engine.startRun();
    engine.spawnTimer = Number.POSITIVE_INFINITY;
    engine.state.enemies.push({
      id: 'elite-test',
      type: 'tank',
      rank: 'elite',
      position: { x: 1900, y: 1200 },
      velocity: { x: 0, y: 0 },
      radius: 26,
      maxHealth: 100,
      health: 0,
      speed: 30,
      damage: 10,
      xpValue: 5,
      color: '#ffd166',
      cooldown: 0,
      hitFlash: 0
    });

    engine.update(1 / 60);

    expect(engine.state.rewardChests).toHaveLength(1);
    expect(engine.state.rewardChests[0].source).toBe('elite');
  });

  it('collects reward chests into chestReward phase and resumes after selection', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      update: (dt: number) => void;
      selectUpgrade: (upgradeId: string) => void;
      spawnTimer: number;
      state: {
        phase: string;
        player: { position: { x: number; y: number } };
        pendingChestChoices: Array<{ id: string }>;
        rewardChests: Array<{ id: string; position: { x: number; y: number }; radius: number; source: 'elite'; opened: boolean; life: number }>;
      };
    };

    engine.startRun();
    engine.spawnTimer = Number.POSITIVE_INFINITY;
    engine.state.rewardChests.push({
      id: 'chest-test',
      position: { ...engine.state.player.position },
      radius: 18,
      source: 'elite',
      opened: false,
      life: 0
    });

    engine.update(1 / 60);

    expect(engine.state.phase).toBe('chestReward');
    expect(engine.state.pendingChestChoices).toHaveLength(3);

    engine.selectUpgrade(engine.state.pendingChestChoices[0].id);

    expect(engine.state.phase).toBe('playing');
    expect(engine.state.pendingChestChoices).toHaveLength(0);
  });

  it('pulls health pickups from the wider pickup magnet range', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      updateHealthPickups: (dt: number) => void;
      state: {
        player: { position: { x: number; y: number }; radius: number; health: number; maxHealth: number; pickupRadius: number };
        healthPickups: Array<{ id: string; position: { x: number; y: number }; heal: number; radius: number; color: string; life: number; maxLife: number }>;
      };
    };

    engine.startRun();
    const startX = engine.state.player.position.x + engine.state.player.pickupRadius * 2.5;
    engine.state.healthPickups.push({
      id: 'distant-health',
      position: { x: startX, y: engine.state.player.position.y },
      heal: 8,
      radius: 11,
      color: '#fb7185',
      life: 0,
      maxLife: 20
    });

    engine.updateHealthPickups(1 / 60);

    expect(engine.state.healthPickups[0].position.x).toBeLessThan(startX);
  });
});

import { WEAPONS } from './content/weapons.registry';

function makeRegistryTestEnemy(): Enemy {
  return {
    id: 'enemy-test',
    type: 'basic',
    rank: 'normal',
    position: { x: 200, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: 17,
    maxHealth: 22,
    health: 22,
    speed: 68,
    damage: 6,
    xpValue: 2,
    color: '#7cf7ff',
    cooldown: 0,
    hitFlash: 0,
  };
}

describe('weapons registry fire() round-trip', () => {
  it('magic-bolt registry fire matches fireWeaponAtTarget for level 1', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapon = createStartingWeapons().find((w) => w.id === 'magic-bolt')!;
    const enemy = makeRegistryTestEnemy();
    const fromLegacy = fireWeaponAtTarget(weapon, player, enemy);
    const fromRegistry = WEAPONS['magic-bolt'].fire({ weapon, player, target: enemy, rng: Math.random });
    expect(fromRegistry).toHaveLength(fromLegacy.length);
    for (let i = 0; i < fromLegacy.length; i += 1) {
      expect(fromRegistry[i].damage).toBe(fromLegacy[i].damage);
      expect(fromRegistry[i].pierce).toBe(fromLegacy[i].pierce);
      expect(fromRegistry[i].kind).toBe(fromLegacy[i].kind);
      expect(fromRegistry[i].color).toBe(fromLegacy[i].color);
    }
  });

  it('piercing-arrow registry fire matches fireWeaponAtTarget for evolved variant', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapon = { ...createStartingWeapons().find((w) => w.id === 'piercing-arrow')!, level: 3, evolved: true };
    const enemy = makeRegistryTestEnemy();
    const fromLegacy = fireWeaponAtTarget(weapon, player, enemy);
    const fromRegistry = WEAPONS['piercing-arrow'].fire({ weapon, player, target: enemy, rng: Math.random });
    expect(fromRegistry).toHaveLength(fromLegacy.length);
    for (let i = 0; i < fromLegacy.length; i += 1) {
      expect(fromRegistry[i].damage).toBe(fromLegacy[i].damage);
      expect(fromRegistry[i].pierce).toBe(fromLegacy[i].pierce);
    }
  });
});

import { PASSIVES as PASSIVES_REGISTRY } from './content/passives.registry';
import { EVOLUTIONS as EVOLUTIONS_REGISTRY } from './content/evolutions.registry';
import { createInitialGameState } from './state';

describe('GameEngine reroll/banish/lock commands', () => {
  it('rerollChoices is a no-op when not in levelUp phase', () => {
    const engine = new GameEngine(() => 0.5);
    engine.startRun();
    engine.rerollChoices();
    expect(engine.getSnapshot().phase).toBe('playing');
  });

  it('drives a level-up via debugLevelUp and exercises reroll, lock, banish', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      debugLevelUp: () => void;
      rerollChoices: () => void;
      banishChoice: (i: number) => void;
      lockChoice: (i: number) => void;
      state: {
        phase: string;
        upgradeChoices: UpgradeOption[];
        agency: { rerolls: number; banishes: number; locks: number; maxRerolls: number; maxLocks: number };
        bannedUpgradeIds: string[];
        lockedSlot: number | null;
      };
    };
    engine.startRun();
    engine.debugLevelUp();
    expect(engine.state.phase).toBe('levelUp');
    expect(engine.state.upgradeChoices.length).toBeGreaterThan(0);
    expect(engine.state.agency.rerolls).toBe(2);
    expect(engine.state.agency.locks).toBe(1);

    engine.lockChoice(0);
    expect(engine.state.lockedSlot).toBe(0);
    expect(engine.state.agency.locks).toBe(0);
    const lockedId = engine.state.upgradeChoices[0].id;

    engine.rerollChoices();
    expect(engine.state.agency.rerolls).toBe(1);
    expect(engine.state.upgradeChoices[0].id).toBe(lockedId);
    expect(engine.state.lockedSlot).toBe(0);

    const slot1IdBeforeBanish = engine.state.upgradeChoices[1]?.id;
    if (slot1IdBeforeBanish) {
      engine.banishChoice(1);
      expect(engine.state.bannedUpgradeIds).toContain(slot1IdBeforeBanish);
      expect(engine.state.agency.banishes).toBe(0);
      expect(engine.state.upgradeChoices[0].id).toBe(lockedId);
    }

    engine.rerollChoices();
    expect(engine.state.agency.rerolls).toBe(0);
    engine.rerollChoices();
    expect(engine.state.agency.rerolls).toBe(0);
  });

  it('lockChoice toggles off without refunding the lock', () => {
    const engine = new GameEngine(() => 0.5) as unknown as {
      startRun: () => void;
      debugLevelUp: () => void;
      lockChoice: (i: number) => void;
      state: { agency: { locks: number }; lockedSlot: number | null };
    };
    engine.startRun();
    engine.debugLevelUp();
    engine.lockChoice(0);
    expect(engine.state.lockedSlot).toBe(0);
    expect(engine.state.agency.locks).toBe(0);
    engine.lockChoice(0);
    expect(engine.state.lockedSlot).toBeNull();
    expect(engine.state.agency.locks).toBe(0);
  });
});

describe('createUpgradeChoices banned + preserveCard', () => {
  function makeRng(): () => number {
    let s = 1;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  it('never returns a banned upgrade id', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapons = createStartingWeapons();
    const banned = ['stat-damage'];
    for (let i = 0; i < 20; i += 1) {
      const choices = createUpgradeChoices(player, weapons, makeRng(), banned);
      expect(choices.find((c) => c.id === 'stat-damage')).toBeUndefined();
    }
  });

  it('preserves the supplied card at index 0 of the result', () => {
    const player = createStartingPlayer({ x: 0, y: 0 });
    const weapons = createStartingWeapons();
    const preserve: UpgradeOption = {
      id: 'stat-pickup-radius',
      title: 'Gem Magnet',
      description: '+28 pickup radius',
      kind: 'stat',
      stat: 'pickupRadius',
      rarity: 'common',
    };
    const choices = createUpgradeChoices(player, weapons, makeRng(), [], preserve);
    expect(choices[0].id).toBe('stat-pickup-radius');
    expect(choices.length).toBeLessThanOrEqual(3);
  });
});

import { calculateRunReward, loadWallet, saveWallet } from './wallet';

describe('wallet', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('calculateRunReward is deterministic for fixed stats', () => {
    const stats = { timeSurvived: 600, kills: 400, level: 12, upgradesCollected: 11, damageDealt: 25000 };
    expect(calculateRunReward(stats, false)).toBe(60 + 20 + 60 + 0);
    expect(calculateRunReward(stats, true)).toBe(60 + 20 + 60 + 200);
  });

  it('loadWallet returns zeros when nothing saved', () => {
    const w = loadWallet();
    expect(w.shards).toBe(0);
    expect(w.lifetimeEarned).toBe(0);
  });

  it('saveWallet round-trips through loadWallet', () => {
    saveWallet({ shards: 123, lifetimeEarned: 456 });
    const w = loadWallet();
    expect(w.shards).toBe(123);
    expect(w.lifetimeEarned).toBe(456);
  });
});

describe('GameSnapshot agency fields', () => {
  it('initial snapshot exposes agency, bannedUpgradeIds, lockedSlot', () => {
    const engine = new GameEngine(() => 0.5);
    const snap = engine.getSnapshot();
    expect(snap.agency).toBeDefined();
    expect(snap.agency.rerolls).toBe(2);
    expect(snap.agency.banishes).toBe(1);
    expect(snap.agency.locks).toBe(1);
    expect(snap.bannedUpgradeIds).toEqual([]);
    expect(snap.lockedSlot).toBeNull();
  });
});

describe('upgrade agency state', () => {
  it('initial GameState has 2 rerolls, 1 banish, 1 lock available', () => {
    const s = createInitialGameState();
    expect(s.agency.rerolls).toBe(2);
    expect(s.agency.banishes).toBe(1);
    expect(s.agency.locks).toBe(1);
    expect(s.agency.maxRerolls).toBe(2);
    expect(s.agency.maxLocks).toBe(1);
    expect(s.bannedUpgradeIds).toEqual([]);
    expect(s.lockedSlot).toBeNull();
  });
});

describe('evolutions registry', () => {
  it('has all four evolutions with correct weapon/passive pairing', () => {
    expect(EVOLUTIONS_REGISTRY['starfall-lance'].weaponId).toBe('magic-bolt');
    expect(EVOLUTIONS_REGISTRY['starfall-lance'].passiveId).toBe('cooldown-sigil');
    expect(EVOLUTIONS_REGISTRY['gravitic-halo'].weaponId).toBe('orbit');
    expect(EVOLUTIONS_REGISTRY['supernova-bloom'].weaponId).toBe('area-pulse');
    expect(EVOLUTIONS_REGISTRY['comet-volley'].weaponId).toBe('piercing-arrow');
  });

  it('all entries default to weaponLevelRequired=6 and passiveLevelRequired=2', () => {
    for (const def of Object.values(EVOLUTIONS_REGISTRY)) {
      expect(def.weaponLevelRequired).toBe(6);
      expect(def.passiveLevelRequired).toBe(2);
    }
  });
});

describe('passives registry', () => {
  it('has identical metadata to the content.ts PASSIVES array', () => {
    const ids = ['cooldown-sigil', 'astral-lens', 'void-core', 'keen-fletching'];
    for (const id of ids) {
      expect(PASSIVES_REGISTRY[id]).toBeDefined();
      expect(PASSIVES_REGISTRY[id].maxLevel).toBe(5);
    }
  });

  it('apply() reproduces existing passive effects', () => {
    const p0 = createStartingPlayer({ x: 0, y: 0 });
    expect(PASSIVES_REGISTRY['cooldown-sigil'].apply(p0).attackRateMultiplier).toBeCloseTo(p0.attackRateMultiplier * 1.08);
    expect(PASSIVES_REGISTRY['astral-lens'].apply(p0).pickupRadius).toBe(p0.pickupRadius + 20);
    expect(PASSIVES_REGISTRY['void-core'].apply(p0).areaMultiplier).toBeCloseTo(p0.areaMultiplier * 1.1);
    expect(PASSIVES_REGISTRY['keen-fletching'].apply(p0).projectileSpeedMultiplier).toBeCloseTo(p0.projectileSpeedMultiplier * 1.12);
  });
});

describe('weapons registry', () => {
  it('has an entry for every WeaponId used by createStartingWeapons', () => {
    const startingIds = createStartingWeapons().map((w) => w.id);
    for (const id of startingIds) {
      expect(WEAPONS[id]).toBeDefined();
      expect(WEAPONS[id].id).toBe(id);
    }
  });

  it('exposes baseFireRate, baseDamage, baseRange that match createStartingWeapons defaults', () => {
    for (const w of createStartingWeapons()) {
      const def = WEAPONS[w.id];
      expect(def.baseFireRate).toBe(w.fireRate);
      expect(def.baseDamage).toBe(w.damage);
      expect(def.baseRange).toBe(w.range);
    }
  });
});
