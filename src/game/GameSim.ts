import { angleTo, circlesOverlapSq, clamp, distanceSq, vectorFromAngle } from './collisions';
import { chooseEnemyType, getBossSpawn, spawnEnemyOutsideViewport, updateEnemies } from './enemies';
import { applyCurseToEnemy as curseEnemy, applyCurseToExistingEnemies as curseExistingEnemies, relieveCurseFromExistingEnemies as relieveCurseExistingEnemies, computeSpawnPack, MAX_CURSE_STACKS, adrenalineRateFactor, isHeavyKill } from './simulation';
import { createDeathParticles, createXpGem, updateParticles } from './particles';
import { damagePlayer, setPlayerFacing, updatePlayerMovement } from './player';
import { startDash, tickDashCooldown, tickDashMotion, resolveDashHits, tryQueueDash, consumeDashQueue } from './dash';
import { resolveProjectileEnemyHit, updateProjectiles } from './projectiles';
import { applyUpgrade, createChestRewardChoices, createUpgradeChoices } from './rewards';
import {
  collectRunDirectorEvents,
  createRiftObjective,
  getBossPhase,
  updateObjectiveProgress,
  type RunDirectorEvent
} from './runDirector';
import { SpatialGrid } from './spatialGrid';
import { createInitialGameState, createStartingPlayer, createStartingWeapons } from './state';
import { getXpThreshold } from './rewards';
import { createAreaPulse, createStarfallSparks, findNearestEnemy, fireWeaponAtTarget } from './weapons';
import type {
  DamageText,
  Enemy,
  GameStats,
  HealthPickup,
  MultiplayerGameState,
  PlayerCommand,
  PlayerRuntime,
  PlayerStatus,
  Projectile,
  RewardChest,
  Telegraph,
  Vector,
  Viewport,
  Weapon
} from './types';

const MAX_PLAYERS = 4;
const PLAYER_COLORS = ['#5eead4', '#ffd166', '#ff5edb', '#a78bfa'];
const MAX_PARTICLES = 220;
const MAX_DAMAGE_TEXTS = 90;
const MAX_TELEGRAPHS = 24;
const MAX_ENEMIES = 240;
const MAX_PLAYER_PROJECTILES = 240;
const MAX_ENEMY_PROJECTILES = 180;
const MAX_GEMS = 400;
const MAX_REWARD_CHESTS = 12;
const HEALTH_PICKUP_MIN_INTERVAL = 10;
const HEALTH_PICKUP_INTERVAL_VARIANCE = 10;
const MAX_HEALTH_PICKUPS = 4;
const HEALTH_PICKUP_MIN_HEAL = 5;
const HEALTH_PICKUP_HEAL_RANGE = 6;
const REVIVE_RADIUS = 62;
const REVIVE_SECONDS = 3;
const REVIVE_HEALTH_RATIO = 0.4;

export function findNearestActivePlayer(players: PlayerRuntime[], position: Vector): PlayerRuntime | undefined {
  let nearest: PlayerRuntime | undefined;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;

  for (const runtime of players) {
    if (runtime.status !== 'active' || runtime.player.health <= 0) {
      continue;
    }

    const currentDistanceSq = distanceSq(runtime.player.position, position);

    if (currentDistanceSq < nearestDistanceSq) {
      nearest = runtime;
      nearestDistanceSq = currentDistanceSq;
    }
  }

  return nearest;
}

function createStats(): GameStats {
  return {
    timeSurvived: 0,
    kills: 0,
    level: 1,
    upgradesCollected: 0,
    damageDealt: 0
  };
}

function resetRuntime(runtime: PlayerRuntime, index: number): PlayerRuntime {
  const offsets = [
    { x: -38, y: -26 },
    { x: 38, y: -26 },
    { x: -38, y: 30 },
    { x: 38, y: 30 }
  ];
  const offset = offsets[index] ?? { x: 0, y: 0 };
  const level = 1;

  return {
    ...runtime,
    status: runtime.status === 'disconnected' ? 'disconnected' : 'active',
    player: createStartingPlayer({ x: 1600 + offset.x, y: 1200 + offset.y }),
    weapons: createStartingWeapons(),
    level,
    xp: 0,
    xpToNext: getXpThreshold(level),
    upgradeChoices: [],
    pendingChestChoices: [],
    stats: createStats(),
    reviveProgress: 0,
    killStreak: 0,
    killStreakExpiry: 0
  };
}

function toMovementInput(command: PlayerCommand | undefined) {
  return {
    up: Boolean(command?.moveUp),
    down: Boolean(command?.moveDown),
    left: Boolean(command?.moveLeft),
    right: Boolean(command?.moveRight)
  };
}

export class GameSim {
  private state: MultiplayerGameState = { ...createInitialGameState(), players: [] };
  private readonly commands = new Map<string, PlayerCommand>();
  private spawnTimer = 0.2;
  private healthPickupTimer = 0;
  private healthPickupSequence = 0;
  private chestSequence = 0;
  private objectiveSequence = 0;
  private bossSummonTimer = 9;
  private playerSequence = 0;
  private readonly enemyGrid = new SpatialGrid(96);

  constructor(private readonly rng: () => number = Math.random) {}

  addPlayer(name: string, id = `player-${this.playerSequence + 1}`): PlayerRuntime {
    if (this.state.players.length >= MAX_PLAYERS) {
      throw new Error('Room is full');
    }

    this.playerSequence += 1;
    const index = this.state.players.length;
    const level = 1;
    const runtime: PlayerRuntime = {
      id,
      name: name.trim() || `Player ${index + 1}`,
      color: PLAYER_COLORS[index] ?? PLAYER_COLORS[0],
      status: this.state.phase === 'playing' ? 'active' : 'disconnected',
      player: createStartingPlayer({ x: 1600, y: 1200 }),
      weapons: createStartingWeapons(),
      level,
      xp: 0,
      xpToNext: getXpThreshold(level),
      upgradeChoices: [],
      pendingChestChoices: [],
      stats: createStats(),
      reviveProgress: 0,
      killStreak: 0,
      killStreakExpiry: 0
    };
    const reset = resetRuntime(runtime, index);

    this.state.players.push(this.state.phase === 'playing' ? reset : { ...reset, status: 'active' });
    return this.state.players[this.state.players.length - 1];
  }

  markDisconnected(playerId: string): void {
    const runtime = this.findPlayer(playerId);
    if (runtime) {
      runtime.status = 'disconnected';
      runtime.reviveProgress = 0;
    }
  }

  markConnected(playerId: string): void {
    const runtime = this.findPlayer(playerId);
    if (!runtime || runtime.status !== 'disconnected') {
      return;
    }

    runtime.status = runtime.player.health > 0 ? 'active' : 'downed';
  }

  removePlayer(playerId: string): void {
    this.state.players = this.state.players.filter((runtime) => runtime.id !== playerId);
    this.commands.delete(playerId);
  }

  setPlayerStatus(playerId: string, status: PlayerStatus): void {
    const runtime = this.findPlayer(playerId);
    if (runtime) {
      runtime.status = status;
    }
  }

  startRun(): void {
    const players = this.state.players;
    players.forEach((runtime, index) => {
      Object.assign(runtime, resetRuntime(runtime, index));
    });
    this.state = { ...createInitialGameState(), phase: 'playing', players };
    this.spawnTimer = 0.2;
    this.healthPickupTimer = this.nextHealthPickupInterval();
    this.healthPickupSequence = 0;
    this.chestSequence = 0;
    this.objectiveSequence = 0;
    this.bossSummonTimer = 9;
    this.commands.clear();
  }

  getState(): MultiplayerGameState {
    return this.state;
  }

  applyCommand(command: PlayerCommand): void {
    const runtime = this.findPlayer(command.playerId);

    if (!runtime || runtime.status === 'disconnected') {
      return;
    }

    if (![command.aimWorldX, command.aimWorldY].every(Number.isFinite)) {
      return;
    }

    this.commands.set(command.playerId, command);
  }

  selectUpgrade(playerId: string, upgradeId: string): void {
    const runtime = this.findPlayer(playerId);

    if (!runtime || runtime.status !== 'choosing') {
      return;
    }

    const choices = runtime.pendingChestChoices.length > 0 ? runtime.pendingChestChoices : runtime.upgradeChoices;
    const choice = choices.find((upgrade) => upgrade.id === upgradeId);

    if (!choice) {
      return;
    }

    const upgraded = applyUpgrade(runtime.player, runtime.weapons, choice);
    runtime.player = upgraded.player;
    runtime.weapons = upgraded.weapons;
    runtime.stats.upgradesCollected += 1;
    runtime.upgradeChoices = [];
    runtime.pendingChestChoices = [];
    runtime.status = runtime.player.health > 0 ? 'active' : 'downed';
    this.addBurstParticles(runtime.player.position, choice.kind === 'evolution' ? '#ffd166' : runtime.color, choice.kind === 'evolution' ? 34 : 14);
  }

  update(dt: number): void {
    const cappedDt = Math.min(0.05, Math.max(0, dt));

    if (this.state.phase !== 'playing') {
      return;
    }

    this.state.screenShake = Math.max(0, this.state.screenShake - cappedDt * 24);
    this.updateRevives(Math.max(0, dt));

    const activePlayers = this.getActivePlayers();
    const connectedPlayers = this.getConnectedPlayers();

    if (connectedPlayers.length === 0 || activePlayers.length === 0) {
      this.updateEffects(cappedDt);
      this.checkEndStates();
      return;
    }

    const previousElapsed = this.state.elapsed;
    this.state.elapsed += cappedDt;
    this.state.difficultyTier = Math.floor(this.state.elapsed / 30);

    for (const runtime of this.state.players) {
      runtime.stats.timeSurvived = this.state.elapsed;
    }

    this.updatePlayers(cappedDt);
    this.processRunDirectorEvents(collectRunDirectorEvents(this.state.runDirector, previousElapsed, this.state.elapsed));
    this.updateObjectives(cappedDt);
    this.spawnEnemies(cappedDt);
    this.spawnHealthPickup(cappedDt);
    this.updateWeapons(cappedDt);
    this.updateEnemies(cappedDt);
    this.updateRangedEnemies(cappedDt);
    this.state.playerProjectiles = updateProjectiles(this.state.playerProjectiles, cappedDt);
    this.state.enemyProjectiles = updateProjectiles(this.state.enemyProjectiles, cappedDt);
    this.resolveCombat();
    this.updateGems(cappedDt);
    this.updateHealthPickups(cappedDt);
    this.updateRewardChests(cappedDt);
    this.updateEffects(cappedDt);
    this.checkEndStates();
  }

  private findPlayer(playerId: string): PlayerRuntime | undefined {
    return this.state.players.find((runtime) => runtime.id === playerId);
  }

  private getConnectedPlayers(): PlayerRuntime[] {
    return this.state.players.filter((runtime) => runtime.status !== 'disconnected');
  }

  private getActivePlayers(): PlayerRuntime[] {
    return this.state.players.filter((runtime) => runtime.status === 'active' && runtime.player.health > 0);
  }

  private processRunDirectorEvents(events: RunDirectorEvent[]): void {
    for (const event of events) {
      if (event.type === 'elite') {
        this.spawnElite();
      } else if (event.type === 'objective') {
        this.spawnRiftObjective(event.scheduledAt);
      } else {
        this.spawnBoss();
      }
    }
  }

  private spawnElite(): void {
    const type = chooseEnemyType(Math.max(this.state.elapsed, 90), this.state.difficultyTier + 2, this.rng);
    const elite = this.applyCurseToEnemy(spawnEnemyOutsideViewport(type === 'boss' ? 'tank' : type, this.getSharedViewport(180), this.state.difficultyTier + 1, this.rng, 'elite'));
    elite.id = `elite-${elite.id}`;
    this.state.enemies.push(elite);
    this.state.screenShake = Math.max(this.state.screenShake, 10);
  }

  private spawnRiftObjective(scheduledAt: number): void {
    this.objectiveSequence += 1;
    const anchor = this.getActivePlayers()[0]?.player.position ?? { x: 1600, y: 1200 };
    this.state.objectives.push(createRiftObjective(`rift-${this.objectiveSequence}`, anchor, this.state.arena, scheduledAt, this.rng));
    this.state.screenShake = Math.max(this.state.screenShake, 8);
  }

  private spawnBoss(): void {
    this.state.enemies.push(getBossSpawn(this.getSharedViewport(), this.state.difficultyTier));
    this.state.bossSpawned = true;
    this.state.screenShake = 22;
  }

  private updatePlayers(dt: number): void {
    for (const runtime of this.state.players) {
      if (runtime.status !== 'active') {
        continue;
      }

      // Expire the kill streak after a lull (mirrors the solo engine's 3s window).
      if (this.state.elapsed > runtime.killStreakExpiry && runtime.killStreak > 0) {
        runtime.killStreak = 0;
      }

      const command = this.commands.get(runtime.id);
      runtime.player = updatePlayerMovement(runtime.player, toMovementInput(command), dt, this.state.arena);
      runtime.player = setPlayerFacing(runtime.player, {
        x: command?.aimWorldX ?? runtime.player.position.x + Math.cos(runtime.player.facingAngle),
        y: command?.aimWorldY ?? runtime.player.position.y + Math.sin(runtime.player.facingAngle)
      });

      // --- Dash (server-authoritative) ---
      // Process dashHeld intent: start a new dash, or queue one if already dashing.
      if (command?.dashHeld) {
        const aimDx = (command.aimWorldX ?? runtime.player.position.x) - runtime.player.position.x;
        const aimDy = (command.aimWorldY ?? runtime.player.position.y) - runtime.player.position.y;
        if (runtime.player.dash.active) {
          runtime.player = tryQueueDash(runtime.player);
        } else {
          const next = startDash(runtime.player, aimDx, aimDy);
          if (next) runtime.player = next;
        }
      }

      // Tick cooldown + motion + hit resolution every frame
      runtime.player = tickDashCooldown(runtime.player, dt);
      const motion = tickDashMotion(runtime.player, dt);
      runtime.player = motion.player;
      if (motion.segment) {
        const hits = resolveDashHits(motion.segment, this.state.enemies, runtime.player);
        if (hits.hits.length > 0) {
          for (const hit of hits.hits) {
            const enemy = this.state.enemies.find((e) => e.id === hit.enemyId);
            if (!enemy) continue;
            enemy.health = Math.max(0, enemy.health - hit.damage);
            enemy.hitFlash = 0.12;
            runtime.stats.damageDealt += hit.damage;
          }
          runtime.player = {
            ...runtime.player,
            dash: { ...runtime.player.dash, hitIds: hits.updatedHitIds }
          };
          this.state.screenShake = Math.max(this.state.screenShake, 4);
        }
      }
      // Consume queued dash on the frame the current one ends
      if (!runtime.player.dash.active && runtime.player.dash.queued) {
        const queueDx = (command?.aimWorldX ?? runtime.player.position.x) - runtime.player.position.x;
        const queueDy = (command?.aimWorldY ?? runtime.player.position.y) - runtime.player.position.y;
        const queued = consumeDashQueue(runtime.player, queueDx, queueDy);
        if (queued) runtime.player = queued;
      }
    }
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;

    if (this.spawnTimer > 0 || this.state.enemies.length >= MAX_ENEMIES) {
      return;
    }

    // Shared spawn + curse logic (src/game/simulation.ts) — kept identical to
    // the solo GameEngine so server and client cannot drift. The server passes
    // the finite population cap; solo runs uncapped.
    const { enemies, interval } = computeSpawnPack({
      elapsed: this.state.elapsed,
      tier: this.state.difficultyTier,
      curseStacks: this.state.enemyCurseStacks,
      viewport: this.getSharedViewport(160),
      rng: this.rng,
      currentEnemyCount: this.state.enemies.length,
      maxEnemies: MAX_ENEMIES,
    });

    for (const enemy of enemies) {
      this.state.enemies.push(enemy);
    }

    this.spawnTimer = interval;
  }

  private applyCurseToEnemy(enemy: Enemy): Enemy {
    return curseEnemy(enemy, this.state.enemyCurseStacks);
  }

  private applyCurseToExistingEnemies(): void {
    curseExistingEnemies(this.state.enemies);
  }

  private relieveCurseFromExistingEnemies(): void {
    relieveCurseExistingEnemies(this.state.enemies);
  }

  private updateObjectives(dt: number): void {
    const activePlayers = this.getActivePlayers();
    const completedIds: string[] = [];
    const cursedIds: string[] = [];

    for (const objective of this.state.objectives) {
      const capturer = activePlayers.find((runtime) => circlesOverlapSq(runtime.player.position, runtime.player.radius, objective.position, objective.radius));
      const result = updateObjectiveProgress([objective], capturer?.player.position ?? { x: -99999, y: -99999 }, dt);

      if (result.completedIds.length > 0) {
        completedIds.push(...result.completedIds);
      }
      if (result.cursedIds.length > 0) {
        cursedIds.push(...result.cursedIds);
      }
    }

    for (const id of completedIds) {
      const objective = this.state.objectives.find((item) => item.id === id);
      if (objective) {
        this.createRewardChest(objective.position, 'objective');
        this.addBurstParticles(objective.position, '#5eead4', 28);
      }
      // Comeback: clearing an objective peels back one active curse stack.
      if (this.state.enemyCurseStacks > 0) {
        this.state.enemyCurseStacks -= 1;
        this.relieveCurseFromExistingEnemies();
      }
    }

    for (const id of cursedIds) {
      const objective = this.state.objectives.find((item) => item.id === id);
      // Cap the curse so failed objectives can't spiral into an unwinnable run.
      if (this.state.enemyCurseStacks < MAX_CURSE_STACKS) {
        this.state.enemyCurseStacks += 1;
        this.applyCurseToExistingEnemies();
      }
      if (objective) {
        this.addBurstParticles(objective.position, '#ff335f', 22);
      }
    }

    this.state.objectives = this.state.objectives.filter((objective) => objective.state === 'active' || this.state.elapsed - objective.spawnedAt < 8);
  }

  private nextHealthPickupInterval(): number {
    return HEALTH_PICKUP_MIN_INTERVAL + this.rng() * HEALTH_PICKUP_INTERVAL_VARIANCE;
  }

  private spawnHealthPickup(dt: number): void {
    this.healthPickupTimer -= dt;

    if (this.healthPickupTimer > 0) {
      return;
    }

    this.healthPickupTimer = this.nextHealthPickupInterval();

    if (this.state.healthPickups.length >= MAX_HEALTH_PICKUPS) {
      return;
    }

    const anchor = this.getActivePlayers()[0];

    if (!anchor) {
      return;
    }

    const angle = this.rng() * Math.PI * 2;
    const distance = 170 + this.rng() * 280;
    const position = {
      x: clamp(anchor.player.position.x + Math.cos(angle) * distance, 40, this.state.arena.width - 40),
      y: clamp(anchor.player.position.y + Math.sin(angle) * distance, 40, this.state.arena.height - 40)
    };

    this.healthPickupSequence += 1;
    this.state.healthPickups.push({
      id: `health-${this.healthPickupSequence}`,
      position,
      heal: HEALTH_PICKUP_MIN_HEAL + Math.floor(this.rng() * HEALTH_PICKUP_HEAL_RANGE),
      radius: 11,
      color: '#fb7185',
      life: 0,
      maxLife: 45
    });
  }

  private updateWeapons(dt: number): void {
    const projectiles: Projectile[] = [];
    this.state.orbitAngle += dt * 2.8;

    for (const runtime of this.getActivePlayers()) {
      const adrenaline = adrenalineRateFactor(runtime.player.passives['adrenal-surge'] ?? 0, runtime.killStreak);
      for (const weapon of runtime.weapons) {
        weapon.cooldown = Math.max(0, weapon.cooldown - dt * runtime.player.attackRateMultiplier * adrenaline);
      }

      for (const weapon of runtime.weapons) {
        if (!weapon.unlocked || weapon.level <= 0) {
          continue;
        }

        if (weapon.id === 'orbit') {
          this.resolveOrbitHits(runtime, weapon);
          continue;
        }

        if (weapon.cooldown > 0) {
          continue;
        }

        if (weapon.id === 'area-pulse') {
          if (projectiles.length >= MAX_PLAYER_PROJECTILES) {
            continue;
          }
          projectiles.push({ ...createAreaPulse(weapon, runtime.player), ownerPlayerId: runtime.id });
          weapon.cooldown = Math.max(weapon.evolved ? 0.45 : 0.7, weapon.fireRate * Math.pow(weapon.evolved ? 0.84 : 0.9, weapon.level - 1));
          continue;
        }

        const target = findNearestEnemy(this.state.enemies, runtime.player.position, weapon.range);

        if (!target) {
          continue;
        }

        const fired = fireWeaponAtTarget(weapon, runtime.player, target, this.rng);
        for (const projectile of fired) {
          if (projectiles.length >= MAX_PLAYER_PROJECTILES) {
            break;
          }
          projectiles.push({ ...projectile, ownerPlayerId: runtime.id });
        }
        weapon.cooldown = Math.max(weapon.evolved ? 0.1 : 0.16, weapon.fireRate * Math.pow(weapon.evolved ? 0.8 : 0.88, weapon.level - 1));
      }
    }

    const availableSlots = MAX_PLAYER_PROJECTILES - this.state.playerProjectiles.length;
    if (availableSlots > 0) {
      this.state.playerProjectiles.push(...projectiles.slice(0, availableSlots));
    }
  }

  private resolveOrbitHits(runtime: PlayerRuntime, weapon: Weapon): void {
    if (weapon.cooldown > 0) {
      return;
    }

    const bladeCount = (1 + Math.floor((weapon.level + 1) / 2)) + (weapon.evolved ? 1 : 0);
    const orbitRadius = (weapon.range + weapon.level * 9) * runtime.player.areaMultiplier * (weapon.evolved ? 1.28 : 1);
    const bladeRadius = 13 + weapon.level + (weapon.evolved ? 5 : 0);
    let hit = false;

    for (const enemy of this.state.enemies) {
      for (let index = 0; index < bladeCount; index += 1) {
        const angle = this.state.orbitAngle + (Math.PI * 2 * index) / bladeCount;
        const bladeX = runtime.player.position.x + Math.cos(angle) * orbitRadius;
        const bladeY = runtime.player.position.y + Math.sin(angle) * orbitRadius;
        const dx = bladeX - enemy.position.x;
        const dy = bladeY - enemy.position.y;
        const radius = bladeRadius + enemy.radius;

        if (dx * dx + dy * dy <= radius * radius) {
          hit = true;
          const damage = Math.round(weapon.damage * runtime.player.damageMultiplier * (1 + weapon.level * 0.28));
          this.pushDamageText(this.createDamageText(enemy, damage, '#f0abfc'));
          runtime.stats.damageDealt += damage;
          enemy.health = Math.max(0, enemy.health - damage);
          enemy.hitFlash = 0.12;
          if (weapon.evolved) {
            enemy.speed *= 0.985;
          }
          break;
        }
      }
    }

    weapon.cooldown = hit ? (weapon.evolved ? 0.11 : 0.18) : 0;
  }

  private updateEnemies(dt: number): void {
    for (const enemy of this.state.enemies) {
      const target = findNearestActivePlayer(this.state.players, enemy.position);
      if (!target) {
        continue;
      }

      updateEnemies([enemy], target.player.position, dt);
    }
  }

  private updateRangedEnemies(dt: number): void {
    const shots: Projectile[] = [];
    const boss = this.state.enemies.find((enemy) => enemy.type === 'boss');

    if (boss) {
      const phase = getBossPhase(boss.health / boss.maxHealth);
      this.bossSummonTimer -= dt;

      if (phase >= 2 && this.bossSummonTimer <= 0) {
        this.bossSummonTimer = 9;
        const viewport = this.getSharedViewport(120);
        for (let index = 0; index < (phase === 3 ? 4 : 3); index += 1) {
          const type = index % 2 === 0 ? 'fast' : 'basic';
          if (this.state.enemies.length < MAX_ENEMIES) {
            this.state.enemies.push(this.applyCurseToEnemy(spawnEnemyOutsideViewport(type, viewport, this.state.difficultyTier, this.rng)));
          }
        }
      }
    }

    for (const enemy of this.state.enemies) {
      if ((enemy.type !== 'ranged' && enemy.type !== 'boss') || enemy.cooldown > 0) {
        continue;
      }

      const target = findNearestActivePlayer(this.state.players, enemy.position);

      if (!target) {
        continue;
      }

      const angle = angleTo(enemy.position, target.player.position);
      const phase = enemy.type === 'boss' ? getBossPhase(enemy.health / enemy.maxHealth) : 1;
      const spreadCount = enemy.type === 'boss' ? (phase === 1 ? 3 : phase === 2 ? 8 : 10) : 1;
      const shotSpeed = enemy.type === 'boss' ? (phase === 3 ? 285 : 230) : 130;

      this.addTelegraph({
        id: `telegraph-${enemy.id}-${this.state.elapsed}`,
        position: { ...enemy.position },
        angle,
        width: enemy.type === 'boss' ? 28 : enemy.rank === 'elite' ? 18 : 10,
        length: enemy.type === 'boss' ? 540 : 330,
        life: 0.22,
        maxLife: 0.22,
        kind: 'line',
        color: enemy.type === 'boss' ? '#ff5d73' : '#ffd166'
      });

      for (let index = 0; index < spreadCount; index += 1) {
        const offset = enemy.type === 'boss' && phase >= 2
          ? (Math.PI * 2 * index) / spreadCount
          : spreadCount === 1 ? 0 : (index - (spreadCount - 1) / 2) * 0.24;
        const shotAngle = enemy.type === 'boss' && phase >= 2 ? offset + this.state.elapsed * 0.35 : angle + offset;
        if (shots.length >= MAX_ENEMY_PROJECTILES) {
          break;
        }
        shots.push({
          id: `enemy-shot-${enemy.id}-${this.state.elapsed}-${index}`,
          owner: 'enemy',
          kind: 'ranged',
          position: { ...enemy.position },
          velocity: vectorFromAngle(shotAngle, shotSpeed),
          radius: 8,
          damage: enemy.damage,
          life: 3.5,
          maxLife: 3.5,
          pierce: 1,
          color: enemy.type === 'boss' ? '#ff5d73' : '#ffd166'
        });
      }

      enemy.cooldown = enemy.type === 'boss' ? (phase === 3 ? 0.92 : phase === 2 ? 1.15 : 1.35) : enemy.rank === 'elite' ? 1.65 : 2.2;
    }

    const availableSlots = MAX_ENEMY_PROJECTILES - this.state.enemyProjectiles.length;
    if (availableSlots > 0) {
      this.state.enemyProjectiles.push(...shots.slice(0, availableSlots));
    }
  }

  private resolveCombat(): void {
    this.resolvePlayerProjectiles();
    this.resolveEnemyProjectiles();
    this.resolveEnemyContact();
    this.collectDeadEnemies();
  }

  private resolvePlayerProjectiles(): void {
    const projectiles = this.state.playerProjectiles;
    let writeIndex = 0;

    this.enemyGrid.clear();
    for (let index = 0; index < this.state.enemies.length; index += 1) {
      const enemy = this.state.enemies[index];
      this.enemyGrid.insert(index, enemy.position.x, enemy.position.y, enemy.radius);
    }

    for (let projectileIndex = 0; projectileIndex < projectiles.length; projectileIndex += 1) {
      let projectile = projectiles[projectileIndex];
      const owner = projectile.ownerPlayerId ? this.findPlayer(projectile.ownerPlayerId) : undefined;
      const candidates = this.enemyGrid.query(projectile.position.x, projectile.position.y, projectile.radius);

      for (const index of candidates) {
        const enemy = this.state.enemies[index];

        if (projectile.hitIds?.has(enemy.id)) {
          continue;
        }

        if (!circlesOverlapSq(projectile.position, projectile.radius, enemy.position, enemy.radius)) {
          continue;
        }

        projectile.hitIds?.add(enemy.id);
        const result = resolveProjectileEnemyHit(projectile, enemy);
        projectile = result.projectile;
        this.state.enemies[index] = result.enemy;
        this.pushDamageText(result.damageText);
        if (owner) {
          owner.stats.damageDealt += result.damageText.amount;
        }
        const sparks = createStarfallSparks(projectile, result.enemy);
        if (sparks.length > 0 && this.state.playerProjectiles.length < 180) {
          this.state.playerProjectiles.push(...sparks.map((spark) => ({ ...spark, ownerPlayerId: projectile.ownerPlayerId })));
        }

        if (projectile.pierce <= 0) {
          break;
        }
      }

      if (projectile.pierce > 0 && projectile.life > 0) {
        projectiles[writeIndex] = projectile;
        writeIndex += 1;
      }
    }

    projectiles.length = writeIndex;
  }

  private resolveEnemyProjectiles(): void {
    const projectiles = this.state.enemyProjectiles;
    let writeIndex = 0;

    projectileLoop:
    for (const projectile of projectiles) {
      for (const runtime of this.getActivePlayers()) {
        if (!circlesOverlapSq(projectile.position, projectile.radius, runtime.player.position, runtime.player.radius)) {
          continue;
        }

        const result = damagePlayer(runtime.player, projectile.damage);
        runtime.player = result.player;
        runtime.status = runtime.player.health <= 0 ? 'downed' : runtime.status;
        this.state.screenShake = result.tookDamage ? 15 : this.state.screenShake;
        continue projectileLoop;
      }

      projectiles[writeIndex] = projectile;
      writeIndex += 1;
    }

    projectiles.length = writeIndex;
  }

  private resolveEnemyContact(): void {
    for (const enemy of this.state.enemies) {
      for (const runtime of this.getActivePlayers()) {
        if (!circlesOverlapSq(enemy.position, enemy.radius, runtime.player.position, runtime.player.radius)) {
          continue;
        }

        const result = damagePlayer(runtime.player, enemy.damage);
        runtime.player = result.player;
        runtime.status = runtime.player.health <= 0 ? 'downed' : runtime.status;
        this.state.screenShake = result.tookDamage ? 18 : this.state.screenShake;
      }
    }
  }

  private collectDeadEnemies(): void {
    const enemies = this.state.enemies;
    let writeIndex = 0;

    for (const enemy of enemies) {
      if (enemy.health > 0) {
        enemies[writeIndex] = enemy;
        writeIndex += 1;
        continue;
      }

      for (const runtime of this.getConnectedPlayers()) {
        runtime.stats.kills += 1;
        // Co-op shares kills, so streaks and Bloodlust are shared momentum.
        runtime.killStreak += 1;
        runtime.killStreakExpiry = this.state.elapsed + 3;
        if (runtime.player.lifestealOnKill > 0 && isHeavyKill(enemy)) {
          runtime.player.health = Math.min(runtime.player.maxHealth, runtime.player.health + runtime.player.lifestealOnKill);
        }
      }
      if (this.state.gems.length < MAX_GEMS) {
        this.state.gems.push(createXpGem(enemy));
      }
      if (enemy.rank === 'elite') {
        this.createRewardChest(enemy.position, 'elite');
      }
      const particleSlots = MAX_PARTICLES - this.state.particles.length;
      if (particleSlots > 0) {
        const particles = createDeathParticles(enemy, this.rng);
        for (let index = 0; index < particles.length && index < particleSlots; index += 1) {
          this.state.particles.push(particles[index]);
        }
      }
      this.state.screenShake = Math.max(this.state.screenShake, enemy.type === 'boss' ? 24 : 5);

      if (enemy.type === 'boss') {
        this.state.phase = 'victory';
      }
    }

    enemies.length = writeIndex;
  }

  private createRewardChest(position: Vector, source: RewardChest['source']): void {
    if (this.state.rewardChests.length >= MAX_REWARD_CHESTS) {
      return;
    }

    this.chestSequence += 1;
    this.state.rewardChests.push({
      id: `chest-${this.chestSequence}`,
      position: { ...position },
      radius: 18,
      source,
      opened: false,
      life: 0
    });
    this.state.screenShake = Math.max(this.state.screenShake, 8);
  }

  private updateGems(dt: number): void {
    const gems = this.state.gems;
    let writeIndex = 0;

    gemLoop:
    for (const gem of gems) {
      let nearestCollector: PlayerRuntime | undefined;
      let nearestDistanceSq = Number.POSITIVE_INFINITY;

      for (const runtime of this.getActivePlayers()) {
        const currentDistanceSq = distanceSq(runtime.player.position, gem.position);
        const magnetRange = runtime.player.pickupRadius * 3.2;
        if (currentDistanceSq < magnetRange * magnetRange && currentDistanceSq < nearestDistanceSq) {
          nearestCollector = runtime;
          nearestDistanceSq = currentDistanceSq;
        }
      }

      if (nearestCollector) {
        const player = nearestCollector.player;
        const magnetRange = player.pickupRadius * 3.2;
        const gemDistance = Math.sqrt(nearestDistanceSq);
        const directionX = gemDistance === 0 ? 0 : (player.position.x - gem.position.x) / gemDistance;
        const directionY = gemDistance === 0 ? 0 : (player.position.y - gem.position.y) / gemDistance;
        const speed = 240 + (1 - gemDistance / magnetRange) * 520;
        gem.position.x += directionX * speed * dt;
        gem.position.y += directionY * speed * dt;
      }

      for (const runtime of this.getActivePlayers()) {
        const pickupRadius = runtime.player.radius + runtime.player.pickupRadius * 0.16;
        if (circlesOverlapSq(gem.position, gem.radius * 3.2, runtime.player.position, pickupRadius)) {
          runtime.xp += gem.value;
          this.resolveLevelUp(runtime);
          continue gemLoop;
        }
      }

      gem.life += dt;
      gems[writeIndex] = gem;
      writeIndex += 1;
    }

    gems.length = writeIndex;
  }

  private updateHealthPickups(dt: number): void {
    const pickups = this.state.healthPickups;
    let writeIndex = 0;

    pickupLoop:
    for (const pickup of pickups) {
      let nearestCollector: PlayerRuntime | undefined;
      let nearestDistanceSq = Number.POSITIVE_INFINITY;

      for (const runtime of this.getActivePlayers()) {
        const currentDistanceSq = distanceSq(runtime.player.position, pickup.position);
        const magnetRange = runtime.player.pickupRadius * 3.2;
        if (currentDistanceSq < magnetRange * magnetRange && currentDistanceSq < nearestDistanceSq) {
          nearestCollector = runtime;
          nearestDistanceSq = currentDistanceSq;
        }
      }

      if (nearestCollector) {
        const player = nearestCollector.player;
        const magnetRange = player.pickupRadius * 3.2;
        const distance = Math.sqrt(nearestDistanceSq);
        const directionX = distance === 0 ? 0 : (player.position.x - pickup.position.x) / distance;
        const directionY = distance === 0 ? 0 : (player.position.y - pickup.position.y) / distance;
        const speed = 220 + (1 - distance / magnetRange) * 500;
        pickup.position.x += directionX * speed * dt;
        pickup.position.y += directionY * speed * dt;
      }

      for (const runtime of this.getActivePlayers()) {
        const collectRadius = runtime.player.radius + runtime.player.pickupRadius * 0.14;
        if (circlesOverlapSq(pickup.position, pickup.radius, runtime.player.position, collectRadius)) {
          runtime.player.health = Math.min(runtime.player.maxHealth, runtime.player.health + pickup.heal);
          continue pickupLoop;
        }
      }

      pickup.life += dt;

      if (pickup.life <= pickup.maxLife) {
        pickups[writeIndex] = pickup;
        writeIndex += 1;
      }
    }

    pickups.length = writeIndex;
  }

  private updateRewardChests(dt: number): void {
    const chests = this.state.rewardChests;
    let writeIndex = 0;

    for (const chest of chests) {
      chest.life += dt;

      const opener = this.getActivePlayers().find((runtime) =>
        !chest.opened && circlesOverlapSq(chest.position, chest.radius, runtime.player.position, runtime.player.radius + 12)
      );

      if (opener) {
        chest.opened = true;
        opener.pendingChestChoices = createChestRewardChoices(opener.player, opener.weapons, this.rng);
        opener.status = 'choosing';
        this.state.screenShake = 10;
        continue;
      }

      if (!chest.opened) {
        chests[writeIndex] = chest;
        writeIndex += 1;
      }
    }

    chests.length = writeIndex;
  }

  private resolveLevelUp(runtime: PlayerRuntime): void {
    while (runtime.xp >= runtime.xpToNext) {
      runtime.xp -= runtime.xpToNext;
      runtime.level += 1;
      runtime.stats.level = runtime.level;
      runtime.xpToNext = getXpThreshold(runtime.level);
      runtime.upgradeChoices = createUpgradeChoices(runtime.player, runtime.weapons, this.rng);
      runtime.status = 'choosing';
      runtime.player.invulnerableTimer = Math.max(runtime.player.invulnerableTimer, 9999);
      this.state.screenShake = 8;
      break;
    }
  }

  private updateRevives(dt: number): void {
    for (const downed of this.state.players) {
      if (downed.status !== 'downed') {
        downed.reviveProgress = 0;
        continue;
      }

      const reviver = this.getActivePlayers().find((runtime) => {
        const command = this.commands.get(runtime.id);
        return Boolean(command?.reviveHeld) && distanceSq(runtime.player.position, downed.player.position) <= REVIVE_RADIUS * REVIVE_RADIUS;
      });

      if (!reviver) {
        downed.reviveProgress = Math.max(0, downed.reviveProgress - dt * 0.8);
        continue;
      }

      downed.reviveProgress += dt;

      if (downed.reviveProgress >= REVIVE_SECONDS) {
        downed.status = 'active';
        downed.reviveProgress = 0;
        downed.player.health = downed.player.maxHealth * REVIVE_HEALTH_RATIO;
        downed.player.invulnerableTimer = 2;
      }
    }
  }

  private updateEffects(dt: number): void {
    this.state.particles = updateParticles(this.state.particles, dt);
    let writeIndex = 0;

    for (const text of this.state.damageTexts) {
      text.position.x += text.velocity.x * dt;
      text.position.y += text.velocity.y * dt;
      text.life -= dt;

      if (text.life > 0) {
        this.state.damageTexts[writeIndex] = text;
        writeIndex += 1;
      }
    }

    this.state.damageTexts.length = writeIndex;

    let telegraphWriteIndex = 0;
    for (const telegraph of this.state.telegraphs) {
      telegraph.life -= dt;
      if (telegraph.life > 0) {
        this.state.telegraphs[telegraphWriteIndex] = telegraph;
        telegraphWriteIndex += 1;
      }
    }
    this.state.telegraphs.length = telegraphWriteIndex;
  }

  private checkEndStates(): void {
    const connected = this.getConnectedPlayers();

    if (connected.length > 0 && connected.every((runtime) => runtime.status === 'downed')) {
      this.state.phase = 'gameOver';
    }
  }

  private createDamageText(enemy: Enemy, amount: number, color: string): DamageText {
    return {
      id: `damage-${enemy.id}-${this.state.elapsed}-${amount}`,
      position: { x: enemy.position.x, y: enemy.position.y - enemy.radius - 8 },
      velocity: { x: 0, y: -38 },
      amount,
      life: 0.55,
      maxLife: 0.55,
      color
    };
  }

  private getSharedViewport(padding = 0): Viewport {
    const anchor = this.getActivePlayers()[0] ?? this.getConnectedPlayers()[0];
    const position = anchor?.player.position ?? { x: 1600, y: 1200 };
    const width = 1280 + padding * 2;
    const height = 720 + padding * 2;
    const x = clamp(position.x - width / 2, 0, Math.max(0, this.state.arena.width - width));
    const y = clamp(position.y - height / 2, 0, Math.max(0, this.state.arena.height - height));

    return {
      x: x - padding,
      y: y - padding,
      width,
      height
    };
  }

  private pushDamageText(text: DamageText): void {
    if (this.state.damageTexts.length >= MAX_DAMAGE_TEXTS) {
      this.state.damageTexts.shift();
    }

    this.state.damageTexts.push(text);
  }

  private addTelegraph(telegraph: Telegraph): void {
    if (this.state.telegraphs.length >= MAX_TELEGRAPHS) {
      this.state.telegraphs.shift();
    }
    this.state.telegraphs.push(telegraph);
  }

  private addBurstParticles(position: Vector, color: string, count: number): void {
    const slots = MAX_PARTICLES - this.state.particles.length;

    for (let index = 0; index < Math.min(slots, count); index += 1) {
      const angle = this.rng() * Math.PI * 2;
      this.state.particles.push({
        id: `burst-${this.state.elapsed}-${index}`,
        position: { ...position },
        velocity: vectorFromAngle(angle, 80 + this.rng() * 220),
        radius: 2 + this.rng() * 5,
        color,
        life: 0.35 + this.rng() * 0.55,
        maxLife: 0.9
      });
    }
  }
}
