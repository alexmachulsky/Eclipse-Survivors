import { angleTo, circlesOverlapSq, clamp, vectorFromAngle } from './collisions';
import { buildCosmicLayers, drawCosmicBackground, drawTwinkleStars, type CosmicLayers } from './cosmic';
import { RUN_LENGTH_SECONDS } from './content';
import {
  startDash,
  tickDashCooldown,
  tickDashMotion,
  resolveDashHits,
  tryQueueDash,
  consumeDashQueue
} from './dash';
import { chooseEnemyType, getBossSpawn, spawnEnemyOutsideViewport, updateEnemies } from './enemies';
import { createDeathParticles, createXpGem, updateParticles } from './particles';
import { damagePlayer, setPlayerFacing, updatePlayerMovement } from './player';
import { resolveProjectileEnemyHit, updateProjectiles } from './projectiles';
import { preloadRenderAssets, type RenderAssets, type SpriteAsset } from './renderAssets';
import { applyUpgrade, createChestRewardChoices, createUpgradeChoices } from './rewards';
import { creditRunReward } from './wallet';
import { applyCurseToEnemy as curseEnemy, applyCurseToExistingEnemies as curseExistingEnemies, relieveCurseFromExistingEnemies as relieveCurseExistingEnemies, computeSpawnPack, MAX_CURSE_STACKS, adrenalineRateFactor, isHeavyKill } from './simulation';
import {
  collectRunDirectorEvents,
  createRiftObjective,
  getActLabel,
  getBossPhase,
  updateObjectiveProgress,
  type RunDirectorEvent
} from './runDirector';
import { SpatialGrid } from './spatialGrid';
import { createInitialGameState } from './state';
import { applyMetaUpgrades, loadMetaUpgrades, salvageMultiplier } from './metaUpgrades';
import { weaponDamageMultiplier } from './synergies';
import { chooseEliteAffix, initEliteAffix, splitterMinions, tickEliteAffix, type AffixIntent } from './eliteAffixes';
import { getXpThreshold } from './rewards';
import { createAreaPulse, createStarfallSparks, findNearestEnemy, fireWeaponAtTarget, getUnlockedWeapons } from './weapons';
import type { DamageText, Enemy, GamePhase, GameState, HealthPickup, InputState, MultiplayerGameState, PlayerRuntime, Projectile, RewardChest, Telegraph, UpgradeOption, Vector, Viewport, Weapon } from './types';

export interface GameSnapshot {
  phase: GamePhase;
  health: number;
  maxHealth: number;
  xp: number;
  xpToNext: number;
  level: number;
  elapsed: number;
  kills: number;
  upgradesCollected: number;
  weapons: Weapon[];
  upgradeChoices: UpgradeOption[];
  stats: GameState['stats'];
  bossSpawned: boolean;
  bossHealthRatio: number | null;
  actLabel: string;
  activeObjective: GameState['objectives'][number] | null;
  enemyCurseStacks: number;
  pendingChestChoices: UpgradeOption[];
  killStreak: number;
  weaponDamageDealt: Record<string, number>;
  upgradeHistory: string[];
  bossApproachingIn: number | null;  // seconds until the boss spawns (RUN_LENGTH_SECONDS), only within the final 30s
  healthRatio: number;               // health/maxHealth convenience field for HUD
  agency: { rerolls: number; banishes: number; locks: number; maxRerolls: number; maxLocks: number };
  bannedUpgradeIds: string[];
  lockedSlot: number | null;
  lastRunReward: number;
  dash: { charges: number; maxCharges: number; rechargeRemaining: number; rechargeDuration: number };
}

const MAX_PARTICLES = 220;
const MAX_DAMAGE_TEXTS = 90;
const MAX_TELEGRAPHS = 24;
const HEALTH_PICKUP_MIN_INTERVAL = 10;
const HEALTH_PICKUP_INTERVAL_VARIANCE = 10;
const MAX_HEALTH_PICKUPS = 4;
const HEALTH_PICKUP_MIN_HEAL = 5;
const HEALTH_PICKUP_HEAL_RANGE = 6;

export class GameEngine {
  private state: GameState = createInitialGameState();
  private input: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    mouse: { x: 0, y: 0 },
    mouseWorld: { x: 0, y: 0 }
  };
  private viewSize = { width: 1280, height: 720 };
  private spawnTimer = 0.2;
  private healthPickupTimer = 0;
  private healthPickupSequence = 0;
  private chestSequence = 0;
  private objectiveSequence = 0;
  private bossSummonTimer = 9;
  private bossEnraged = false;  // one-shot guard for the phase-3 enrage cue
  private rng: () => number;
  private cosmic: CosmicLayers | null = null;
  private renderAssets: RenderAssets | null = null;
  private readonly enemyGrid = new SpatialGrid(96);
  private glowScale = 1;
  private performanceMode = false;
  private fastRender = false;
  // Cached canvas gradients. Gradients are transformed by the CTM at paint time
  // (not creation), so invariant gradients — health-bar variants (fixed local
  // coords) and the view-sized vignette — can be built once and reused across
  // every enemy / frame instead of allocated + colour-parsed each draw. Keyed to
  // the creating context; invalidated if the canvas context ever changes.
  private gradientCacheCtx: CanvasRenderingContext2D | null = null;
  private healthBarGradients = new Map<string, CanvasGradient>();
  private vignetteGradient: CanvasGradient | null = null;
  private vignetteGradientKey = '';
  private lowHpVignetteGradient: CanvasGradient | null = null;
  private lowHpVignetteKey = '';
  // Exhaust-plume gradients keyed by `${plumeIndex}:${roundedLength}`. The plume
  // length throbs every frame but quantizing to integer px yields a tiny set of
  // reusable gradients; per-frame alpha is applied via globalAlpha instead.
  private exhaustGradients = new Map<string, CanvasGradient>();
  // Dash-trail glow gradient, baked once at the origin per integer radius bucket.
  // The per-particle world position is applied via ctx.translate at draw time
  // (gradient coords are resolved through the live CTM), and the life-driven
  // alpha via globalAlpha — so a handful of gradients cover the whole trail.
  private dashTrailGradients = new Map<number, CanvasGradient>();
  private dashTrail: Array<{ x: number; y: number; t: number }> = [];
  private dashHitPulseCounter = 0;
  private static readonly DASH_TRAIL_LIFE = 0.25;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  startRun(): void {
    this.state = createInitialGameState();
    // SOLO ONLY: apply persistent Star Forge meta-upgrades to the fresh player.
    // Done here (not in createInitialGameState) so the bonuses never reach the
    // shared LAN sim (GameSim), which calls the same factory.
    this.state.player = applyMetaUpgrades(this.state.player, loadMetaUpgrades());
    this.state.phase = 'playing';
    this.spawnTimer = 0.2;
    this.healthPickupTimer = this.nextHealthPickupInterval();
    this.healthPickupSequence = 0;
    this.chestSequence = 0;
    this.objectiveSequence = 0;
    this.bossSummonTimer = 9;
    this.bossEnraged = false;
  }

  pause(): void {
    if (this.state.phase === 'playing') {
      this.state.phase = 'paused';
    }
  }

  resume(): void {
    if (this.state.phase === 'paused') {
      this.state.phase = 'playing';
    }
  }

  togglePause(): void {
    if (this.state.phase === 'playing') {
      this.pause();
    } else if (this.state.phase === 'paused') {
      this.resume();
    }
  }

  debugLevelUp(): void {
    if (this.state.phase !== 'playing') {
      return;
    }

    this.state.agency.rerolls = this.state.agency.maxRerolls;
    this.state.agency.locks = this.state.agency.maxLocks;
    this.state.lockedSlot = null;
    this.state.upgradeChoices = createUpgradeChoices(this.state.player, this.state.weapons, this.rng, this.state.bannedUpgradeIds);
    this.state.phase = 'levelUp';
  }

  debugOpenChest(): void {
    if (this.state.phase !== 'playing') {
      return;
    }

    this.state.pendingChestChoices = createChestRewardChoices(this.state.player, this.state.weapons, this.rng);
    this.state.phase = 'chestReward';
  }

  debugSpawnObjective(): void {
    if (this.state.phase === 'playing') {
      this.spawnRiftObjective(this.state.elapsed);
    }
  }

  debugSpawnElite(): void {
    if (this.state.phase === 'playing') {
      this.spawnElite();
    }
  }

  debugSpawnBoss(): void {
    if (this.state.phase === 'playing' && !this.state.bossSpawned) {
      this.spawnBoss();
    }
  }

  setPerformanceMode(enabled: boolean): void {
    this.performanceMode = enabled;
  }

  isPerformanceMode(): boolean {
    return this.performanceMode;
  }

  preloadRenderAssets(): void {
    this.ensureCosmic();
    this.renderAssets = preloadRenderAssets();
  }

  loadMultiplayerState(state: MultiplayerGameState, localPlayerId: string): void {
    const localRuntime = state.players.find((runtime) => runtime.id === localPlayerId) ?? state.players[0];

    if (!localRuntime) {
      return;
    }

    this.state = {
      ...state,
      player: localRuntime.player,
      weapons: localRuntime.weapons,
      upgradeChoices: localRuntime.upgradeChoices,
      pendingChestChoices: localRuntime.pendingChestChoices,
      level: localRuntime.level,
      xp: localRuntime.xp,
      xpToNext: localRuntime.xpToNext,
      stats: localRuntime.stats
    };
  }

  setViewSize(width: number, height: number): void {
    this.viewSize = {
      width: Math.max(320, width),
      height: Math.max(240, height)
    };
    this.input.mouseWorld = this.screenToWorld(this.input.mouse);
  }

  setMovement(partial: Partial<Pick<InputState, 'up' | 'down' | 'left' | 'right'>>): void {
    this.input = { ...this.input, ...partial };
  }

  setMouse(position: Vector): void {
    this.input.mouse = position;
    this.input.mouseWorld = this.screenToWorld(position);
  }

  dash(): void {
    if (this.state.phase !== 'playing') return;
    // Block new dashes during boss-spawn cinematic
    if (this.state.cinematicState) return;
    const player = this.state.player;
    const dx = this.input.mouseWorld.x - player.position.x;
    const dy = this.input.mouseWorld.y - player.position.y;
    if (player.dash.active) {
      this.state.player = tryQueueDash(player);
      return;
    }
    const next = startDash(player, dx, dy);
    if (next) {
      const flareX = player.position.x;
      const flareY = player.position.y;
      this.state.player = next;
      this.spawnDashHitPulse(flareX, flareY);
    }
  }

  selectUpgrade(upgradeId: string): void {
    if (this.state.phase !== 'levelUp' && this.state.phase !== 'chestReward') {
      return;
    }

    const choices = this.state.phase === 'chestReward' ? this.state.pendingChestChoices : this.state.upgradeChoices;
    const choice = choices.find((upgrade) => upgrade.id === upgradeId);

    if (!choice) {
      return;
    }

    const upgraded = applyUpgrade(this.state.player, this.state.weapons, choice);
    this.state.player = upgraded.player;
    this.state.weapons = upgraded.weapons;
    this.state.stats.upgradesCollected += 1;
    this.state.upgradeChoices = [];
    this.state.pendingChestChoices = [];
    this.state.lockedSlot = null;
    // 2c: Track upgrade history
    this.state.upgradeHistory.push(choice.title);
    this.state.phase = 'playing';
    this.addBurstParticles(this.state.player.position, choice.kind === 'evolution' ? '#ffd166' : '#5eead4', choice.kind === 'evolution' ? 34 : 14);
  }

  rerollChoices(): void {
    if (this.state.phase !== 'levelUp') return;
    if (this.state.agency.rerolls <= 0) return;
    const lockedIdx = this.state.lockedSlot;
    const lockedCard = lockedIdx !== null ? this.state.upgradeChoices[lockedIdx] : undefined;
    this.state.upgradeChoices = createUpgradeChoices(
      this.state.player,
      this.state.weapons,
      this.rng,
      this.state.bannedUpgradeIds,
      lockedCard,
    );
    this.state.lockedSlot = lockedCard ? 0 : null;
    this.state.agency.rerolls -= 1;
  }

  banishChoice(index: number): void {
    if (this.state.phase !== 'levelUp') return;
    if (this.state.agency.banishes <= 0) return;
    const card = this.state.upgradeChoices[index];
    if (!card) return;
    if (this.state.lockedSlot === index) return;
    this.state.bannedUpgradeIds.push(card.id);
    const lockedIdx = this.state.lockedSlot;
    const lockedCard = lockedIdx !== null ? this.state.upgradeChoices[lockedIdx] : undefined;
    this.state.upgradeChoices = createUpgradeChoices(
      this.state.player,
      this.state.weapons,
      this.rng,
      this.state.bannedUpgradeIds,
      lockedCard,
    );
    this.state.lockedSlot = lockedCard ? 0 : null;
    this.state.agency.banishes -= 1;
  }

  lockChoice(index: number): void {
    if (this.state.phase !== 'levelUp') return;
    if (index < 0 || index >= this.state.upgradeChoices.length) return;
    if (this.state.lockedSlot === index) {
      this.state.lockedSlot = null;
      return;
    }
    if (this.state.agency.locks <= 0) return;
    this.state.lockedSlot = index;
    this.state.agency.locks -= 1;
  }

  update(dt: number): void {
    const cappedDt = Math.min(0.05, Math.max(0, dt));

    if (this.state.phase !== 'playing') {
      return;
    }

    // Apply time scale for effects like level-up slow-mo. Re-cap so sub-modules
    // always receive dt <= 0.05 even if timeScale climbs above 1 in the future
    // (prevents physics tunneling — see CLAUDE.md hot-path rules).
    const scaledDt = Math.min(0.05, cappedDt * this.state.timeScale);

    // Ramp timeScale back toward 1.0 (using raw dt, not scaled dt)
    if (this.state.timeScale < 1.0) {
      this.state.timeScale = Math.min(1.0, this.state.timeScale + cappedDt * 4);
    }

    // Tick down cinematic timer
    if (this.state.cinematicState) {
      this.state.cinematicState.timer -= cappedDt;
      if (this.state.cinematicState.timer <= 0) {
        this.state.cinematicState = null;
      }
    }

    // Check kill streak expiry (2a)
    if (this.state.elapsed > this.state.killStreakExpiry && this.state.killStreak > 0) {
      this.state.killStreak = 0;
    }

    const previousElapsed = this.state.elapsed;
    this.state.elapsed += scaledDt;
    this.state.stats.timeSurvived = this.state.elapsed;
    this.state.difficultyTier = Math.floor(this.state.elapsed / 30);
    this.state.screenShake = Math.max(0, this.state.screenShake - scaledDt * 24);
    this.input.mouseWorld = this.screenToWorld(this.input.mouse);
    this.updatePlayer(scaledDt);
    // --- Dash mechanic ---
    // Always tick (so in-progress dashes complete during cinematics, but new dashes
    // are blocked in the dash() command above when cinematic is active).
    this.state.player = tickDashCooldown(this.state.player, scaledDt);
    const dashMotion = tickDashMotion(this.state.player, scaledDt);
    this.state.player = dashMotion.player;
    // Trail sampling — push while active, age every frame, drop expired
    if (this.state.player.dash.active) {
      this.dashTrail.push({ x: this.state.player.position.x, y: this.state.player.position.y, t: 0 });
      if (this.dashTrail.length > 10) this.dashTrail.shift();
    }
    for (const sample of this.dashTrail) sample.t += scaledDt;
    this.dashTrail = this.dashTrail.filter((s) => s.t < GameEngine.DASH_TRAIL_LIFE);
    if (dashMotion.segment) {
      const dashHits = resolveDashHits(dashMotion.segment, this.state.enemies, this.state.player);
      if (dashHits.hits.length > 0) {
        for (const hit of dashHits.hits) {
          const enemy = this.state.enemies.find((e) => e.id === hit.enemyId);
          if (!enemy) continue;
          enemy.health = Math.max(0, enemy.health - hit.damage);
          enemy.hitFlash = 0.12;
          this.state.stats.damageDealt += hit.damage;
          this.pushDamageText({
            id: `dash-${enemy.id}-${this.state.elapsed}-${hit.damage}`,
            position: { x: hit.hitX, y: hit.hitY - enemy.radius - 8 },
            velocity: { x: 0, y: -42 },
            amount: Math.round(hit.damage),
            life: 0.55,
            maxLife: 0.55,
            color: '#a8f3ff'
          });
          this.spawnDashHitPulse(hit.hitX, hit.hitY);
        }
        this.state.player = {
          ...this.state.player,
          dash: { ...this.state.player.dash, hitIds: dashHits.updatedHitIds }
        };
        this.state.screenShake = Math.max(this.state.screenShake, 4);
      }
    }
    // Consume queued dash on the frame the current one ends
    if (!this.state.player.dash.active && this.state.player.dash.queued) {
      const queueDx = this.input.mouseWorld.x - this.state.player.position.x;
      const queueDy = this.input.mouseWorld.y - this.state.player.position.y;
      const queued = consumeDashQueue(this.state.player, queueDx, queueDy);
      if (queued) this.state.player = queued;
    }
    this.processRunDirectorEvents(collectRunDirectorEvents(this.state.runDirector, previousElapsed, this.state.elapsed));
    this.updateObjectives(scaledDt);

    // Pause gameplay during boss-spawn cinematic (first 0.6s)
    const isInCinematic = this.state.cinematicState !== null && this.state.cinematicState.timer > 1.9;
    if (!isInCinematic) {
      this.spawnEnemies(scaledDt);
      this.spawnHealthPickup(scaledDt);
      this.updateWeapons(scaledDt);
      this.state.enemies = updateEnemies(this.state.enemies, this.state.player.position, scaledDt);
      this.updateRangedEnemies(scaledDt);
      this.updateEliteAffixes(scaledDt);
    }

    this.state.playerProjectiles = updateProjectiles(this.state.playerProjectiles, scaledDt, this.state.enemies);
    this.state.enemyProjectiles = updateProjectiles(this.state.enemyProjectiles, scaledDt);
    this.resolveCombat();
    this.updateGems(scaledDt);
    this.updateHealthPickups(scaledDt);
    this.updateRewardChests(scaledDt);
    this.updateEffects(scaledDt);
    this.checkEndStates();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const viewport = this.getViewport();
    const shake = this.state.screenShake > 0 ? this.state.screenShake : 0;
    const shakePhase = this.state.elapsed * 47.23 + shake * 0.113;
    const shakeOffset = {
      x: Math.sin(shakePhase) * shake * 0.45,
      y: Math.cos(shakePhase * 1.37) * shake * 0.45
    };

    ctx.clearRect(0, 0, this.viewSize.width, this.viewSize.height);
    if (this.gradientCacheCtx !== ctx) {
      // New canvas context — cached gradients belong to the old one; rebuild lazily.
      this.gradientCacheCtx = ctx;
      this.healthBarGradients.clear();
      this.vignetteGradient = null;
      this.vignetteGradientKey = '';
      this.lowHpVignetteGradient = null;
      this.lowHpVignetteKey = '';
      this.exhaustGradients.clear();
      this.dashTrailGradients.clear();
    }
    this.glowScale = this.getGlowScale();
    this.fastRender = this.performanceMode || this.glowScale === 0;
    this.drawBackdrop(ctx);

    ctx.save();
    ctx.translate(shakeOffset.x - viewport.x, shakeOffset.y - viewport.y);
    this.drawArena(ctx, viewport);
    if (!this.performanceMode) {
      drawTwinkleStars(ctx, this.ensureCosmic().twinkleStars, this.state.elapsed);
    }
    this.drawGems(ctx, viewport);
    this.drawHealthPickups(ctx, viewport);
    this.drawObjectives(ctx, viewport);
    this.drawRewardChests(ctx, viewport);
    this.drawTelegraphs(ctx, viewport);
    this.drawProjectiles(ctx, this.state.playerProjectiles, viewport);
    this.drawProjectiles(ctx, this.state.enemyProjectiles, viewport);
    this.drawDashTrail(ctx);
    this.drawEnemies(ctx, viewport);
    this.drawOrbitWeapon(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx, viewport);
    this.drawDamageTexts(ctx, viewport);
    ctx.restore();

    this.drawEdgeMarkers(ctx, viewport);
    this.drawVignette(ctx);
    // 2d: Draw boss cinematic if active
    if (this.state.cinematicState) {
      this.drawBossCinematic(ctx, this.state.cinematicState.timer);
    }
  }

  getSnapshot(): GameSnapshot {
    const boss = this.state.enemies.find((enemy) => enemy.type === 'boss');

    return {
      phase: this.state.phase,
      health: this.state.player.health,
      maxHealth: this.state.player.maxHealth,
      xp: this.state.xp,
      xpToNext: this.state.xpToNext,
      level: this.state.level,
      elapsed: this.state.elapsed,
      kills: this.state.stats.kills,
      upgradesCollected: this.state.stats.upgradesCollected,
      weapons: getUnlockedWeapons(this.state.weapons),
      upgradeChoices: this.state.upgradeChoices,
      stats: { ...this.state.stats, level: this.state.level, timeSurvived: this.state.elapsed },
      bossSpawned: this.state.bossSpawned,
      bossHealthRatio: boss ? clamp(boss.health / boss.maxHealth, 0, 1) : null,
      actLabel: getActLabel(this.state.elapsed),
      activeObjective: this.state.objectives.find((objective) => objective.state === 'active') ?? null,
      enemyCurseStacks: this.state.enemyCurseStacks,
      pendingChestChoices: this.state.pendingChestChoices,
      killStreak: this.state.killStreak,
      weaponDamageDealt: this.state.weaponDamageDealt,
      upgradeHistory: this.state.upgradeHistory,
      bossApproachingIn: !this.state.bossSpawned && (RUN_LENGTH_SECONDS - this.state.elapsed) <= 30
        ? Math.ceil(RUN_LENGTH_SECONDS - this.state.elapsed)
        : null,
      healthRatio: this.state.player.health / this.state.player.maxHealth,
      agency: { ...this.state.agency },
      bannedUpgradeIds: [...this.state.bannedUpgradeIds],
      lockedSlot: this.state.lockedSlot,
      lastRunReward: this.state.lastRunReward,
      dash: {
        charges: this.state.player.dash.charges,
        maxCharges: this.state.player.dash.maxCharges + this.state.player.dashChargeBonus,
        rechargeRemaining: this.state.player.dash.rechargeRemaining,
        rechargeDuration: this.state.player.dash.rechargeDuration * (this.state.player.dashRechargeMult ?? 1)
      }
    };
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
    const elite = this.applyCurseToEnemy(spawnEnemyOutsideViewport(type === 'boss' ? 'tank' : type, this.getViewport(180), this.state.difficultyTier + 1, this.rng, 'elite'));
    elite.id = `elite-${elite.id}`;
    initEliteAffix(elite, chooseEliteAffix(this.rng));
    this.state.enemies.push(elite);
    this.state.screenShake = Math.max(this.state.screenShake, 10);
  }

  private spawnRiftObjective(scheduledAt: number): void {
    this.objectiveSequence += 1;
    this.state.objectives.push(createRiftObjective(`rift-${this.objectiveSequence}`, this.state.player.position, this.state.arena, scheduledAt, this.rng));
    this.state.screenShake = Math.max(this.state.screenShake, 8);
  }

  private spawnBoss(): void {
    this.state.enemies.push(getBossSpawn(this.getViewport(), this.state.difficultyTier));
    this.state.bossSpawned = true;
    this.state.screenShake = 22;
    // 2d: Boss spawn cinematic
    this.state.cinematicState = { type: 'boss-spawn', timer: 2.5 };
  }

  private updatePlayer(dt: number): void {
    this.state.player = updatePlayerMovement(this.state.player, this.input, dt, this.state.arena);
    this.state.player = setPlayerFacing(this.state.player, this.input.mouseWorld);
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;

    if (this.spawnTimer > 0) {
      return;
    }

    // Solo is uncapped (maxEnemies: Infinity); the authoritative GameSim passes
    // a finite cap. Spawn + curse logic is shared (src/game/simulation.ts).
    const { enemies, interval } = computeSpawnPack({
      elapsed: this.state.elapsed,
      tier: this.state.difficultyTier,
      curseStacks: this.state.enemyCurseStacks,
      viewport: this.getViewport(160),
      rng: this.rng,
      currentEnemyCount: this.state.enemies.length,
      maxEnemies: Infinity,
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
    const result = updateObjectiveProgress(this.state.objectives, this.state.player.position, dt);

    for (const id of result.completedIds) {
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

    for (const id of result.cursedIds) {
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

    this.state.objectives = result.objectives.filter((objective) => objective.state === 'active' || this.state.elapsed - objective.spawnedAt < 8);
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

    const angle = this.rng() * Math.PI * 2;
    const distance = 170 + this.rng() * 280;
    const position = {
      x: clamp(this.state.player.position.x + Math.cos(angle) * distance, 40, this.state.arena.width - 40),
      y: clamp(this.state.player.position.y + Math.sin(angle) * distance, 40, this.state.arena.height - 40)
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
    const adrenaline = adrenalineRateFactor(this.state.player.passives['adrenal-surge'] ?? 0, this.state.killStreak);
    for (const weapon of this.state.weapons) {
      weapon.cooldown = Math.max(0, weapon.cooldown - dt * this.state.player.attackRateMultiplier * adrenaline);
    }

    for (const weapon of this.state.weapons) {
      if (!weapon.unlocked || weapon.level <= 0) {
        continue;
      }

      if (weapon.id === 'orbit') {
        this.resolveOrbitHits(weapon);
        continue;
      }

      if (weapon.cooldown > 0) {
        continue;
      }

      if (weapon.id === 'area-pulse') {
        projectiles.push(createAreaPulse(weapon, this.state.player));
        weapon.cooldown = Math.max(weapon.evolved ? 0.45 : 0.7, weapon.fireRate * Math.pow(weapon.evolved ? 0.84 : 0.9, weapon.level - 1));
        // 2h: Muzzle flash for area-pulse
        this.spawnMuzzleFlash(weapon);
        continue;
      }

      const target = findNearestEnemy(this.state.enemies, this.state.player.position, weapon.range);

      if (!target) {
        continue;
      }

      projectiles.push(...fireWeaponAtTarget(weapon, this.state.player, target, this.rng));
      weapon.cooldown = Math.max(weapon.evolved ? 0.1 : 0.16, weapon.fireRate * Math.pow(weapon.evolved ? 0.8 : 0.88, weapon.level - 1));
      // 2h: Muzzle flash for projectile weapons
      this.spawnMuzzleFlash(weapon);
    }

    this.state.playerProjectiles.push(...projectiles);
  }

  private resolveOrbitHits(weapon: Weapon): void {
    if (weapon.cooldown > 0) {
      return;
    }

    const bladeCount = (1 + Math.floor((weapon.level + 1) / 2)) + (weapon.evolved ? 1 : 0);
    const orbitRadius = (weapon.range + weapon.level * 9) * this.state.player.areaMultiplier * (weapon.evolved ? 1.28 : 1);
    const bladeRadius = 13 + weapon.level + (weapon.evolved ? 5 : 0);
    let hit = false;

    for (const enemy of this.state.enemies) {
      for (let index = 0; index < bladeCount; index += 1) {
        const angle = this.state.orbitAngle + (Math.PI * 2 * index) / bladeCount;
        const bladeX = this.state.player.position.x + Math.cos(angle) * orbitRadius;
        const bladeY = this.state.player.position.y + Math.sin(angle) * orbitRadius;
        const dx = bladeX - enemy.position.x;
        const dy = bladeY - enemy.position.y;
        const radius = bladeRadius + enemy.radius;

        if (dx * dx + dy * dy <= radius * radius) {
          hit = true;
          const damage = Math.round(weapon.damage * weaponDamageMultiplier(weapon, this.state.player) * (1 + weapon.level * 0.28));
          this.pushDamageText(this.createDamageText(enemy, damage, '#f0abfc'));
          this.state.stats.damageDealt += damage;
          // 2b: Track orbit weapon damage
          this.state.weaponDamageDealt[weapon.id] = (this.state.weaponDamageDealt[weapon.id] ?? 0) + damage;
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

  private updateRangedEnemies(dt: number): void {
    const shots: Projectile[] = [];
    const boss = this.state.enemies.find((enemy) => enemy.type === 'boss');

    if (boss) {
      const phase = getBossPhase(boss.health / boss.maxHealth);
      this.bossSummonTimer -= dt;

      // Phase-3 enrage: telegraph the (already mechanical) escalation with a
      // one-shot shake + red burst so the difficulty spike reads on screen.
      if (phase >= 3 && !this.bossEnraged) {
        this.bossEnraged = true;
        this.state.screenShake = Math.max(this.state.screenShake, 24);
        this.addBurstParticles(boss.position, '#ff335f', 40);
      }

      if (phase >= 2 && this.bossSummonTimer <= 0) {
        this.bossSummonTimer = 9;
        const viewport = this.getViewport(120);
        for (let index = 0; index < (phase === 3 ? 4 : 3); index += 1) {
          const type = index % 2 === 0 ? 'fast' : 'basic';
          this.state.enemies.push(this.applyCurseToEnemy(spawnEnemyOutsideViewport(type, viewport, this.state.difficultyTier, this.rng)));
        }
      }
    }

    for (const enemy of this.state.enemies) {
      if ((enemy.type !== 'ranged' && enemy.type !== 'boss') || enemy.cooldown > 0) {
        continue;
      }

      const angle = angleTo(enemy.position, this.state.player.position);
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

    this.state.enemyProjectiles.push(...shots);
  }

  // Advance every affixed elite's telegraphed ability and apply the intents it
  // emits. Affix MATH lives in the shared pure module (eliteAffixes.ts); this
  // engine only owns the glue (telegraph push, player damage, projectile spawn)
  // so solo and the authoritative LAN sim stay in lockstep. Guarded by
  // `enemy.affix` so the un-affixed swarm never allocates an intent array.
  private updateEliteAffixes(dt: number): void {
    for (const enemy of this.state.enemies) {
      if (!enemy.affix) continue;
      const intents = tickEliteAffix(enemy, {
        dt,
        nearestPlayerPos: this.state.player.health > 0 ? this.state.player.position : null,
        elapsed: this.state.elapsed
      });
      for (const intent of intents) this.applyAffixIntent(intent);
    }
  }

  private applyAffixIntent(intent: AffixIntent): void {
    switch (intent.kind) {
      case 'telegraph':
        this.addTelegraph(intent.telegraph);
        break;
      case 'bomb': {
        // Telegraphed AoE — the warning ring gave the player time to clear it.
        if (circlesOverlapSq(intent.position, intent.radius, this.state.player.position, this.state.player.radius)) {
          const result = damagePlayer(this.state.player, intent.damage);
          this.state.player = result.player;
          if (result.tookDamage) this.state.screenShake = Math.max(this.state.screenShake, 16);
        }
        this.addBurstParticles(intent.position, '#ffa23e', 18);
        break;
      }
      case 'snipe':
        // Solo enemy projectiles are uncapped (matches updateRangedEnemies).
        this.state.enemyProjectiles.push({
          id: `affix-snipe-${intent.origin.x.toFixed(1)}-${intent.origin.y.toFixed(1)}-${this.state.elapsed.toFixed(3)}`,
          owner: 'enemy',
          kind: 'ranged',
          position: { ...intent.origin },
          velocity: vectorFromAngle(intent.angle, intent.speed),
          radius: 7,
          damage: intent.damage,
          life: 2.1,
          maxLife: 2.1,
          pierce: 1,
          color: '#ff5d73'
        });
        break;
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
        this.state.stats.damageDealt += result.damageText.amount;
        // 2b: Track weapon damage
        if (projectile.weaponId) {
          this.state.weaponDamageDealt[projectile.weaponId] = (this.state.weaponDamageDealt[projectile.weaponId] ?? 0) + result.damageText.amount;
        }
        const sparks = createStarfallSparks(projectile, result.enemy);
        if (sparks.length > 0 && this.state.playerProjectiles.length < 180) {
          this.state.playerProjectiles.push(...sparks);
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

    for (const projectile of projectiles) {
      if (circlesOverlapSq(projectile.position, projectile.radius, this.state.player.position, this.state.player.radius)) {
        const result = damagePlayer(this.state.player, projectile.damage);
        this.state.player = result.player;
        this.state.screenShake = result.tookDamage ? 15 : this.state.screenShake;
        continue;
      }

      projectiles[writeIndex] = projectile;
      writeIndex += 1;
    }

    projectiles.length = writeIndex;
  }

  private resolveEnemyContact(): void {
    for (const enemy of this.state.enemies) {
      if (!circlesOverlapSq(enemy.position, enemy.radius, this.state.player.position, this.state.player.radius)) {
        continue;
      }

      const result = damagePlayer(this.state.player, enemy.damage);
      this.state.player = result.player;
      this.state.screenShake = result.tookDamage ? 18 : this.state.screenShake;
    }
  }

  private collectDeadEnemies(): void {
    const enemies = this.state.enemies;
    let writeIndex = 0;
    // Splitter elites spawn minions on death. Collect them here but append only
    // AFTER compaction below — pushing into `enemies` mid-loop would corrupt the
    // in-place filter (it iterates the same array we're rewriting).
    const splitMinions: Enemy[] = [];

    for (const enemy of enemies) {
      if (enemy.health > 0) {
        enemies[writeIndex] = enemy;
        writeIndex += 1;
        continue;
      }

      this.state.stats.kills += 1;

      // Bloodlust: restore HP when slaying a tough foe (never the basic swarm).
      if (this.state.player.lifestealOnKill > 0 && isHeavyKill(enemy)) {
        this.state.player.health = Math.min(this.state.player.maxHealth, this.state.player.health + this.state.player.lifestealOnKill);
      }

      // 2a: Kill streak tracking
      this.state.killStreak += 1;
      this.state.killStreakExpiry = this.state.elapsed + 3; // streak resets after 3s

      // Spawn streak milestone floaties (2a)
      if (this.state.killStreak === 3) {
        this.spawnStreakText('×3 🔥', '#ffd166');
      } else if (this.state.killStreak === 5) {
        this.spawnStreakText('×5 🔥🔥', '#ff5edb');
      } else if (this.state.killStreak === 10) {
        this.spawnStreakText('×10 🔥', '#ff335f');
      } else if (this.state.killStreak === 20) {
        this.spawnStreakText('×20 🔥', '#ff335f');
      }

      this.state.gems.push(createXpGem(enemy));
      if (enemy.rank === 'elite') {
        this.createRewardChest(enemy.position, 'elite');
      }
      if (enemy.affix === 'splitter') {
        for (const minion of splitterMinions(enemy, this.rng)) splitMinions.push(minion);
        this.addTelegraph({
          id: `affix-split-${enemy.id}-${this.state.elapsed.toFixed(3)}`,
          position: { ...enemy.position },
          angle: 0,
          width: 6,
          length: enemy.radius + 30,
          life: 0.35,
          maxLife: 0.35,
          kind: 'ring',
          color: '#b388ff'
        });
      }
      const particleSlots = MAX_PARTICLES - this.state.particles.length;
      if (particleSlots > 0) {
        const particles = createDeathParticles(enemy, this.rng);
        for (let index = 0; index < particles.length && index < particleSlots; index += 1) {
          this.state.particles.push(particles[index]);
        }

        // 2g: Type-specific death particles
        if (enemy.type === 'boss') {
          // Shockwave: add a telegraph ring
          this.state.telegraphs.push({
            id: `shockwave-${this.state.elapsed}`,
            position: { ...enemy.position },
            angle: 0,
            width: 0,
            length: 220, // radius
            life: 0.45,
            maxLife: 0.45,
            kind: 'ring',
            color: '#ff335f'
          });
          // Extra 30 particles for boss
          for (let i = 0; i < 30; i++) {
            const angle = (i / 30) * Math.PI * 2;
            if (this.state.particles.length < MAX_PARTICLES) {
              this.state.particles.push({
                id: `bd-${i}-${this.state.elapsed}`,
                position: { ...enemy.position },
                velocity: { x: Math.cos(angle) * (80 + this.rng() * 120), y: Math.sin(angle) * (80 + this.rng() * 120) },
                radius: 3 + this.rng() * 4,
                color: '#ff335f',
                life: 0.8 + this.rng() * 0.4,
                maxLife: 1.2
              });
            }
          }
        } else if (enemy.type === 'tank') {
          // 8 large hex-like fragments
          for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            if (this.state.particles.length < MAX_PARTICLES) {
              this.state.particles.push({
                id: `td-${i}-${this.state.elapsed}`,
                position: { ...enemy.position },
                velocity: { x: Math.cos(angle) * (40 + this.rng() * 60), y: Math.sin(angle) * (40 + this.rng() * 60) },
                radius: 5 + this.rng() * 3,
                color: i % 2 === 0 ? '#a78bfa' : '#94a3b8',
                life: 0.6 + this.rng() * 0.3,
                maxLife: 0.9
              });
            }
          }
        }
      }
      this.state.screenShake = Math.max(this.state.screenShake, enemy.type === 'boss' ? 24 : 5);

      if (enemy.type === 'boss') {
        this.state.phase = 'victory';
        this.creditWallet(true);
      }
    }

    enemies.length = writeIndex;
    // Safe to append now that the in-place compaction is done (solo is uncapped).
    for (const minion of splitMinions) enemies.push(minion);
  }

  private createRewardChest(position: Vector, source: RewardChest['source']): void {
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
    const player = this.state.player;
    const magnetRange = player.pickupRadius * 3.2;
    const magnetRangeSq = magnetRange * magnetRange;
    const pickupRadius = player.radius + player.pickupRadius * 0.16;
    let writeIndex = 0;

    for (const gem of gems) {
      const dx = player.position.x - gem.position.x;
      const dy = player.position.y - gem.position.y;
      const distanceSq = dx * dx + dy * dy;

      if (distanceSq < magnetRangeSq) {
        const gemDistance = Math.sqrt(distanceSq);
        const directionX = gemDistance === 0 ? 0 : dx / gemDistance;
        const directionY = gemDistance === 0 ? 0 : dy / gemDistance;
        const speed = 240 + (1 - gemDistance / magnetRange) * 520;
        gem.position.x += directionX * speed * dt;
        gem.position.y += directionY * speed * dt;
      }

      if (circlesOverlapSq(gem.position, gem.radius * 3.2, player.position, pickupRadius)) {
        this.state.xp += gem.value;
        this.resolveLevelUp();
        continue;
      }

      gem.life += dt;
      gems[writeIndex] = gem;
      writeIndex += 1;
    }

    gems.length = writeIndex;
  }

  private updateHealthPickups(dt: number): void {
    const pickups = this.state.healthPickups;
    let player = this.state.player;
    const magnetRange = player.pickupRadius * 3.2;
    const magnetRangeSq = magnetRange * magnetRange;
    const collectRadius = player.radius + player.pickupRadius * 0.14;
    let writeIndex = 0;

    for (const pickup of pickups) {
      const dx = player.position.x - pickup.position.x;
      const dy = player.position.y - pickup.position.y;
      const distanceSq = dx * dx + dy * dy;

      if (distanceSq < magnetRangeSq) {
        const distance = Math.sqrt(distanceSq);
        const directionX = distance === 0 ? 0 : dx / distance;
        const directionY = distance === 0 ? 0 : dy / distance;
        const speed = 220 + (1 - distance / magnetRange) * 500;
        pickup.position.x += directionX * speed * dt;
        pickup.position.y += directionY * speed * dt;
      }

      if (circlesOverlapSq(pickup.position, pickup.radius, player.position, collectRadius)) {
        // Immutable reassignment — sub-state is never mutated in place (see
        // CLAUDE.md state-mutation rules). `player` is rebound for the rest of
        // this loop so later pickups stack correctly within the same frame.
        player = { ...player, health: Math.min(player.maxHealth, player.health + pickup.heal) };
        this.state.player = player;
        continue;
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

      if (!chest.opened && circlesOverlapSq(chest.position, chest.radius, this.state.player.position, this.state.player.radius + 12)) {
        chest.opened = true;
        this.state.pendingChestChoices = createChestRewardChoices(this.state.player, this.state.weapons, this.rng);
        this.state.phase = 'chestReward';
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

  private resolveLevelUp(): void {
    while (this.state.xp >= this.state.xpToNext) {
      this.state.xp -= this.state.xpToNext;
      this.state.level += 1;
      this.state.stats.level = this.state.level;
      this.state.xpToNext = getXpThreshold(this.state.level);
      this.state.agency.rerolls = this.state.agency.maxRerolls;
      this.state.agency.locks = this.state.agency.maxLocks;
      this.state.lockedSlot = null;
      this.state.upgradeChoices = createUpgradeChoices(this.state.player, this.state.weapons, this.rng, this.state.bannedUpgradeIds);
      this.state.phase = 'levelUp';
      this.state.screenShake = 8;

      // 2e: Level-up time-slow effect
      this.state.timeScale = 0.35; // brief slow-mo

      // 2e: Spawn particle burst on level-up (20 cyan particles)
      this.spawnLevelUpBurst();

      break;
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
    if (this.state.phase === 'gameOver' || this.state.phase === 'victory') return;
    if (this.state.player.health <= 0) {
      this.state.phase = 'gameOver';
      this.creditWallet(false);
    }
  }

  private creditWallet(won: boolean): void {
    // Idempotent: the run reward is credited exactly once per run regardless of
    // how many phase transitions or duplicate end-state checks occur (see
    // CLAUDE.md). `walleted` resets with the rest of state on startRun().
    if (this.state.walleted) return;
    this.state.walleted = true;
    this.state.lastRunReward = creditRunReward(this.state.stats, won, salvageMultiplier(loadMetaUpgrades()));
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

  // 2a: Spawn streak milestone text
  private spawnStreakText(text: string, color: string): void {
    const damageText: DamageText = {
      id: `streak-${this.state.elapsed}-${this.rng()}`,
      position: { x: this.state.player.position.x, y: this.state.player.position.y - 80 },
      velocity: { x: 0, y: -120 },
      amount: 0,
      life: 1.2,
      maxLife: 1.2,
      color,
      text
    };
    this.pushDamageText(damageText);
  }

  // 2e: Spawn level-up particle burst
  private spawnLevelUpBurst(): void {
    const particleCount = 20;
    const slots = MAX_PARTICLES - this.state.particles.length;

    for (let i = 0; i < Math.min(slots, particleCount); i++) {
      const angle = (i / particleCount) * Math.PI * 2;
      const speed = 200 + this.rng() * 150;
      this.state.particles.push({
        id: `levelup-${this.state.elapsed}-${i}`,
        position: { ...this.state.player.position },
        velocity: {
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed - 50  // upward bias for fountain effect
        },
        radius: 3 + this.rng() * 2,
        color: '#5eead4',  // cyan
        life: 0.7,
        maxLife: 0.7
      });
    }
  }

  // 2h: Spawn muzzle flash
  private spawnMuzzleFlash(weapon: Weapon): void {
    const flashColors: Record<string, string> = {
      'magic-bolt': '#5eead4',
      'piercing-arrow': '#ffd166',
      'area-pulse': '#a78bfa'
    };
    const fc = flashColors[weapon.id] ?? '#ffffff';
    const slots = MAX_PARTICLES - this.state.particles.length;

    for (let f = 0; f < Math.min(slots, 3); f++) {
      const angle = this.rng() * Math.PI * 2;
      this.state.particles.push({
        id: `mf-${weapon.id}-${f}-${this.state.elapsed}`,
        position: { ...this.state.player.position },
        velocity: { x: Math.cos(angle) * 60, y: Math.sin(angle) * 60 },
        radius: 2,
        color: fc,
        life: 0.08,
        maxLife: 0.08
      });
    }
  }

  private getViewport(padding = 0): Viewport {
    const width = this.viewSize.width + padding * 2;
    const height = this.viewSize.height + padding * 2;
    const x = clamp(this.state.player.position.x - width / 2, 0, Math.max(0, this.state.arena.width - width));
    const y = clamp(this.state.player.position.y - height / 2, 0, Math.max(0, this.state.arena.height - height));

    return {
      x: x - padding,
      y: y - padding,
      width,
      height
    };
  }

  private screenToWorld(screen: Vector): Vector {
    const viewport = this.getViewport();

    return {
      x: viewport.x + screen.x,
      y: viewport.y + screen.y
    };
  }

  private getGlowScale(): number {
    if (this.performanceMode) {
      return 0;
    }

    const entities =
      this.state.enemies.length +
      this.state.playerProjectiles.length +
      this.state.enemyProjectiles.length +
      this.state.gems.length +
      this.state.healthPickups.length +
      this.state.particles.length +
      this.state.damageTexts.length;

    if (entities >= 90) {
      return 0;
    }

    if (entities >= 55) {
      return 0.35;
    }

    return 1;
  }

  private setGlow(ctx: CanvasRenderingContext2D, blur: number, color: string): void {
    const scaledBlur = blur * this.glowScale;
    ctx.shadowBlur = scaledBlur;

    if (scaledBlur > 0) {
      ctx.shadowColor = color;
    }
  }

  // Health bars share a handful of gradients (one per width × colour tier). The
  // gradient's local coords are fixed, so a single cached object paints
  // correctly for every enemy under its own translate (CTM applies at paint
  // time). Saves one createLinearGradient + colour-stop parse per enemy/frame.
  private getHealthBarGradient(ctx: CanvasRenderingContext2D, width: number, tier: 0 | 1 | 2): CanvasGradient {
    const key = `${width}:${tier}`;
    let grad = this.healthBarGradients.get(key);
    if (!grad) {
      const x = -width / 2;
      grad = ctx.createLinearGradient(x, 0, x + width, 0);
      if (tier === 2) {
        grad.addColorStop(0, '#5eead4');
        grad.addColorStop(1, '#38bdf8');
      } else if (tier === 1) {
        grad.addColorStop(0, '#fde68a');
        grad.addColorStop(1, '#f59e0b');
      } else {
        grad.addColorStop(0, '#fb7185');
        grad.addColorStop(1, '#ef4444');
      }
      this.healthBarGradients.set(key, grad);
    }
    return grad;
  }

  // The vignette is a full-screen radial gradient that only depends on the view
  // size, yet was rebuilt every frame. Cache it until the view size changes.
  private getVignetteGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
    const key = `${this.viewSize.width}x${this.viewSize.height}`;
    if (!this.vignetteGradient || this.vignetteGradientKey !== key) {
      const radius = Math.max(this.viewSize.width, this.viewSize.height) * 0.72;
      const cx = this.viewSize.width / 2;
      const cy = this.viewSize.height / 2;
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.40)');
      this.vignetteGradient = grad;
      this.vignetteGradientKey = key;
    }
    return this.vignetteGradient;
  }

  private pushDamageText(text: DamageText): void {
    if (this.state.damageTexts.length >= MAX_DAMAGE_TEXTS) {
      this.state.damageTexts.shift();
    }

    this.state.damageTexts.push(text);
  }

  private spawnDashHitPulse(x: number, y: number): void {
    this.dashHitPulseCounter += 1;
    if (this.state.particles.length >= MAX_PARTICLES) return;
    this.state.particles.push({
      id: `dash-pulse-${this.state.elapsed.toFixed(3)}-${this.dashHitPulseCounter}`,
      position: { x, y },
      velocity: { x: 0, y: 0 },
      radius: 18,
      color: '#ffffff',
      life: 0.18,
      maxLife: 0.18
    });
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
        id: `burst-${this.state.elapsed}-${index}-${this.rng()}`,
        position: { ...position },
        velocity: vectorFromAngle(angle, 80 + this.rng() * 220),
        radius: 2 + this.rng() * 5,
        color,
        life: 0.35 + this.rng() * 0.55,
        maxLife: 0.9
      });
    }
  }

  private ensureCosmic(): CosmicLayers {
    if (!this.cosmic) {
      this.cosmic = buildCosmicLayers(
        this.viewSize.width,
        this.viewSize.height,
        this.state.arena.width,
        this.state.arena.height,
        this.rng
      );
    }
    return this.cosmic;
  }

  private ensureRenderAssets(): RenderAssets {
    if (!this.renderAssets) {
      this.renderAssets = preloadRenderAssets();
    }

    return this.renderAssets;
  }

  private drawSprite(ctx: CanvasRenderingContext2D, sprite: SpriteAsset, x: number, y: number, width: number, height = width): void {
    ctx.drawImage(sprite.image, x - width / 2, y - height / 2, width, height);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const layers = this.ensureCosmic();
    const viewport = this.getViewport();
    drawCosmicBackground(ctx, layers, viewport.x, viewport.y, this.viewSize.width, this.viewSize.height, this.performanceMode);
  }

  private isCircleVisible(position: Vector, radius: number, viewport: Viewport, padding = 0): boolean {
    const paddedRadius = radius + padding;

    return (
      position.x + paddedRadius >= viewport.x &&
      position.x - paddedRadius <= viewport.x + viewport.width &&
      position.y + paddedRadius >= viewport.y &&
      position.y - paddedRadius <= viewport.y + viewport.height
    );
  }

  private drawArena(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    const layers = this.ensureCosmic();
    const padding = 40;
    const sx = Math.max(0, Math.floor(viewport.x - padding));
    const sy = Math.max(0, Math.floor(viewport.y - padding));
    const sw = Math.min(this.state.arena.width - sx, Math.ceil(viewport.width + padding * 2));
    const sh = Math.min(this.state.arena.height - sy, Math.ceil(viewport.height + padding * 2));

    if (sw > 0 && sh > 0) {
      ctx.drawImage(layers.floorTile, sx, sy, sw, sh, sx, sy, sw, sh);
    }

    ctx.strokeStyle = '#5eead455';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, this.state.arena.width, this.state.arena.height);
  }

  private drawGems(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    const sprite = this.ensureRenderAssets().gem;

    for (const gem of this.state.gems) {
      if (!this.isCircleVisible(gem.position, gem.radius, viewport, 18)) {
        continue;
      }

      const pulse = Math.sin(gem.life * 8) * 0.18 + 1;
      ctx.save();
      ctx.globalAlpha = 0.85;
      this.drawSprite(ctx, sprite, gem.position.x, gem.position.y, gem.radius * 3.2 * pulse);
      ctx.restore();
    }
  }

  private drawHealthPickups(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    for (const pickup of this.state.healthPickups) {
      if (!this.isCircleVisible(pickup.position, pickup.radius, viewport, 24)) {
        continue;
      }

      this.drawHealthPickup(ctx, pickup);
    }
  }

  private drawHealthPickup(ctx: CanvasRenderingContext2D, pickup: HealthPickup): void {
    const pulse = 1 + Math.sin((this.state.elapsed + pickup.life) * 6) * 0.08;
    const sprite = this.ensureRenderAssets().healthPickup;
    this.drawSprite(ctx, sprite, pickup.position.x, pickup.position.y, pickup.radius * 4.1 * pulse);
  }

  private drawObjectives(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    for (const objective of this.state.objectives) {
      if (!this.isCircleVisible(objective.position, objective.radius, viewport, 50)) {
        continue;
      }

      const progress = clamp(objective.captureProgress / objective.requiredCapture, 0, 1);
      const pulse = 1 + Math.sin((this.state.elapsed - objective.spawnedAt) * 5) * 0.04;

      ctx.save();
      ctx.translate(objective.position.x, objective.position.y);
      ctx.globalAlpha = objective.state === 'active' ? 1 : 0.45;
      this.setGlow(ctx, 24, objective.state === 'cursed' ? '#ff335f' : '#5eead4');
      ctx.strokeStyle = objective.state === 'cursed' ? '#ff335f' : '#5eead4';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, objective.radius * pulse, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(0, 0, objective.radius * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawRewardChests(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    const assets = this.ensureRenderAssets();

    for (const chest of this.state.rewardChests) {
      if (!this.isCircleVisible(chest.position, chest.radius, viewport, 24)) {
        continue;
      }

      const pulse = 1 + Math.sin((this.state.elapsed + chest.life) * 7) * 0.08;
      const sprite = chest.source === 'elite' ? assets.rewardChest.elite : assets.rewardChest.objective;
      this.drawSprite(ctx, sprite, chest.position.x, chest.position.y, chest.radius * 4 * pulse);
    }
  }

  private drawTelegraphs(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    for (const telegraph of this.state.telegraphs) {
      if (!this.isCircleVisible(telegraph.position, telegraph.length, viewport, 0)) {
        continue;
      }

      const alpha = clamp(telegraph.life / telegraph.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha * 0.45;

      if (telegraph.kind === 'ring') {
        ctx.translate(telegraph.position.x, telegraph.position.y);
        ctx.strokeStyle = telegraph.color;
        ctx.lineWidth = 3;
        ctx.shadowColor = telegraph.color;
        ctx.shadowBlur = this.glowScale > 0 ? 12 : 0;
        ctx.beginPath();
        ctx.arc(0, 0, telegraph.length * (1 - telegraph.life / telegraph.maxLife + 0.1), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.translate(telegraph.position.x, telegraph.position.y);
        ctx.rotate(telegraph.angle);
        ctx.fillStyle = telegraph.color;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.rect(0, -telegraph.width / 2, telegraph.length, telegraph.width);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[], viewport: Viewport): void {
    const sprites = this.ensureRenderAssets().projectiles;

    for (const projectile of projectiles) {
      if (!this.isCircleVisible(projectile.position, projectile.radius, viewport, projectile.kind === 'arrow' ? 30 : 20)) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = projectile.alpha ?? 1;

      if (projectile.kind === 'pulse') {
        this.drawSprite(ctx, sprites.pulse, projectile.position.x, projectile.position.y, projectile.radius * 2.25);
      } else if (projectile.kind === 'arrow') {
        const angle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
        const speed = Math.sqrt(projectile.velocity.x * projectile.velocity.x + projectile.velocity.y * projectile.velocity.y) || 1;

        if (!this.fastRender) {
          ctx.globalAlpha = (projectile.alpha ?? 1) * 0.32;
          ctx.strokeStyle = projectile.color;
          ctx.lineWidth = Math.max(2, projectile.radius * 0.45);
          ctx.beginPath();
          ctx.moveTo(projectile.position.x - (projectile.velocity.x / speed) * projectile.radius * 4.2, projectile.position.y - (projectile.velocity.y / speed) * projectile.radius * 4.2);
          ctx.lineTo(projectile.position.x, projectile.position.y);
          ctx.stroke();
          ctx.globalAlpha = projectile.alpha ?? 1;
        }

        ctx.translate(projectile.position.x, projectile.position.y);
        ctx.rotate(angle);
        this.drawSprite(ctx, sprites.arrow, 0, 0, projectile.radius * 7.2, projectile.radius * 4.2);
      } else if (projectile.kind === 'missile') {
        const angle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
        const speed = Math.sqrt(projectile.velocity.x * projectile.velocity.x + projectile.velocity.y * projectile.velocity.y) || 1;
        const r = projectile.radius;

        if (!this.fastRender) {
          // Exhaust streak behind the missile.
          ctx.globalAlpha = (projectile.alpha ?? 1) * 0.4;
          ctx.strokeStyle = projectile.color;
          ctx.lineWidth = Math.max(2, r * 0.7);
          ctx.beginPath();
          ctx.moveTo(projectile.position.x - (projectile.velocity.x / speed) * r * 3.6, projectile.position.y - (projectile.velocity.y / speed) * r * 3.6);
          ctx.lineTo(projectile.position.x, projectile.position.y);
          ctx.stroke();
          ctx.globalAlpha = projectile.alpha ?? 1;
        }

        ctx.translate(projectile.position.x, projectile.position.y);
        ctx.rotate(angle);
        if (this.glowScale > 0) {
          ctx.shadowColor = projectile.color;
          ctx.shadowBlur = 8 * this.glowScale;
        }
        ctx.fillStyle = projectile.color;
        ctx.beginPath();
        ctx.moveTo(r * 1.6, 0);
        ctx.lineTo(-r, r * 0.8);
        ctx.lineTo(-r * 0.4, 0);
        ctx.lineTo(-r, -r * 0.8);
        ctx.closePath();
        ctx.fill();
      } else {
        const sprite = projectile.kind === 'ranged' ? sprites.ranged : sprites.bolt;
        this.drawSprite(ctx, sprite, projectile.position.x, projectile.position.y, projectile.radius * 5);
      }

      ctx.restore();
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    const assets = this.ensureRenderAssets();

    for (const enemy of this.state.enemies) {
      if (!this.isCircleVisible(enemy.position, enemy.radius, viewport, enemy.type === 'boss' ? 80 : 42)) {
        continue;
      }

      ctx.save();
      ctx.translate(enemy.position.x, enemy.position.y);
      this.applyHitSquash(ctx, enemy.hitFlash);

      if (enemy.type === 'ranged') {
        const charge = clamp(1 - enemy.cooldown / 0.5, 0, 1);
        if (charge > 0.7) {
          const jitterPhase = this.state.elapsed * 64 + this.hashId(enemy.id) * 0.13;
          ctx.translate(Math.sin(jitterPhase) * 0.75, Math.cos(jitterPhase * 1.41) * 0.75);
        }
      }

      let modelRotation = 0;
      if (enemy.type === 'fast') {
        const speed = Math.sqrt(enemy.velocity.x * enemy.velocity.x + enemy.velocity.y * enemy.velocity.y);
        modelRotation = speed > 1
          ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
          : Math.atan2(this.state.player.position.y - enemy.position.y, this.state.player.position.x - enemy.position.x);
      } else if (enemy.type === 'basic') {
        modelRotation = Math.atan2(this.state.player.position.y - enemy.position.y, this.state.player.position.x - enemy.position.x);
      }

      if (modelRotation !== 0) {
        ctx.rotate(modelRotation);
      }

      const spriteGroup = assets.enemies[enemy.type];
      const sprite = this.fastRender ? spriteGroup.lite : enemy.hitFlash > 0 ? spriteGroup.hit : spriteGroup.normal;
      const scale = enemy.type === 'boss' ? 3.75 : enemy.type === 'tank' ? 3.35 : enemy.type === 'fast' ? 3.8 : 3.25;
      this.drawSprite(ctx, sprite, 0, 0, enemy.radius * scale);

      if (modelRotation !== 0) {
        ctx.rotate(-modelRotation);
      }

      if (!this.fastRender && enemy.type === 'ranged') {
        this.drawRangedChargeOverlay(ctx, enemy);
      }

      if (!this.fastRender && enemy.type === 'boss') {
        this.drawBossRingOverlay(ctx, enemy);
      }

      if (enemy.health < enemy.maxHealth || enemy.type === 'boss') {
        this.drawEnemyHealth(ctx, enemy);
      }

      if (enemy.rank === 'elite') {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius + 7 + Math.sin(this.state.elapsed * 7) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private hashId(id: string): number {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) | 0;
    }
    return Math.abs(hash);
  }

  private drawRangedChargeOverlay(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const charge = clamp(1 - enemy.cooldown / 0.5, 0, 1);

    if (charge <= 0) {
      return;
    }

    const px = this.state.player.position.x - enemy.position.x;
    const py = this.state.player.position.y - enemy.position.y;
    const plen = Math.sqrt(px * px + py * py) || 1;
    const coreR = enemy.radius * (0.35 + charge * 0.45);

    ctx.save();
    ctx.globalAlpha = charge * 0.68;
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(0, 0, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff3b0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo((px / plen) * enemy.radius * 1.45, (py / plen) * enemy.radius * 1.45);
    ctx.stroke();
    ctx.restore();
  }

  private drawBossRingOverlay(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = enemy.radius;
    const t = this.state.elapsed;

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(0, 0, r + 16, t * 1.2, t * 1.2 + Math.PI * 1.1);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff8aa1';
    ctx.beginPath();
    ctx.arc(0, 0, r + 24, -t * 0.85, -t * 0.85 + Math.PI * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  private drawEnemyHealth(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const isBoss = enemy.type === 'boss';
    const width = isBoss ? 170 : 42;
    const height = isBoss ? 9 : 6;
    const y = -enemy.radius - 14;
    const ratio = clamp(enemy.health / enemy.maxHealth, 0, 1);
    this.drawHealthBarRounded(ctx, width, height, y, ratio, isBoss);
  }

  private drawOrbitWeapon(ctx: CanvasRenderingContext2D): void {
    for (const runtime of this.getRenderablePlayers()) {
      this.drawRuntimeOrbitWeapon(ctx, runtime);
    }
  }

  private drawRuntimeOrbitWeapon(ctx: CanvasRenderingContext2D, runtime: PlayerRuntime): void {
    const weapon = runtime.weapons.find((item) => item.id === 'orbit' && item.unlocked);

    if (!weapon) {
      return;
    }

    const sprite = weapon.evolved ? this.ensureRenderAssets().orbit.evolved : this.ensureRenderAssets().orbit.normal;
    const bladeCount = (1 + Math.floor((weapon.level + 1) / 2)) + (weapon.evolved ? 1 : 0);
    const orbitRadius = (weapon.range + weapon.level * 9) * runtime.player.areaMultiplier * (weapon.evolved ? 1.28 : 1);

    for (let index = 0; index < bladeCount; index += 1) {
      const angle = this.state.orbitAngle + (Math.PI * 2 * index) / bladeCount;
      const position = {
        x: runtime.player.position.x + Math.cos(angle) * orbitRadius,
        y: runtime.player.position.y + Math.sin(angle) * orbitRadius
      };
      ctx.save();
      ctx.translate(position.x, position.y);
      ctx.rotate(angle);
      this.drawSprite(ctx, sprite, 0, 0, weapon.evolved ? 58 : 46, weapon.evolved ? 34 : 28);
      ctx.restore();
    }
  }

  private drawEdgeMarkers(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    const targets = [
      ...this.state.objectives
        .filter((objective) => objective.state === 'active')
        .map((objective) => ({ position: objective.position, color: '#5eead4', size: 13 })),
      ...this.state.rewardChests.map((chest) => ({ position: chest.position, color: '#ffd166', size: 12 })),
      ...this.state.enemies
        .filter((enemy) => enemy.rank === 'elite' || enemy.type === 'boss')
        .map((enemy) => ({ position: enemy.position, color: enemy.type === 'boss' ? '#ff335f' : '#ffd166', size: enemy.type === 'boss' ? 16 : 12 }))
    ];

    for (const target of targets) {
      const screenX = target.position.x - viewport.x;
      const screenY = target.position.y - viewport.y;

      if (screenX >= 20 && screenX <= this.viewSize.width - 20 && screenY >= 20 && screenY <= this.viewSize.height - 20) {
        continue;
      }

      const center = { x: this.viewSize.width / 2, y: this.viewSize.height / 2 };
      const angle = Math.atan2(screenY - center.y, screenX - center.x);
      const x = clamp(screenX, 22, this.viewSize.width - 22);
      const y = clamp(screenY, 22, this.viewSize.height - 22);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = target.color;
      this.setGlow(ctx, 14, target.color);
      ctx.beginPath();
      ctx.moveTo(target.size, 0);
      ctx.lineTo(-target.size * 0.65, -target.size * 0.55);
      ctx.lineTo(-target.size * 0.65, target.size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    for (const runtime of this.getRenderablePlayers()) {
      this.drawRuntimePlayer(ctx, runtime);
    }
  }

  private getRenderablePlayers(): PlayerRuntime[] {
    const players = (this.state as GameState & { players?: PlayerRuntime[] }).players;

    if (players) {
      return players.filter((runtime) => runtime.status !== 'disconnected');
    }

    return [{
      id: 'solo',
      name: 'Player',
      color: '#5eead4',
      status: this.state.player.health <= 0 ? 'downed' : 'active',
      player: this.state.player,
      weapons: this.state.weapons,
      level: this.state.level,
      xp: this.state.xp,
      xpToNext: this.state.xpToNext,
      upgradeChoices: this.state.upgradeChoices,
      pendingChestChoices: this.state.pendingChestChoices,
      stats: this.state.stats,
      reviveProgress: 0,
      killStreak: this.state.killStreak,
      killStreakExpiry: this.state.killStreakExpiry
    }];
  }

  private drawRuntimePlayer(ctx: CanvasRenderingContext2D, runtime: PlayerRuntime): void {
    const player = runtime.player;
    const r = player.radius;
    const t = this.state.elapsed;
    const iframes = player.invulnerableTimer > 0 || runtime.status === 'choosing';
    const sprite = iframes ? this.ensureRenderAssets().playerHit : this.ensureRenderAssets().player;

    ctx.save();
    ctx.translate(player.position.x, player.position.y);
    ctx.rotate(player.facingAngle);
    ctx.globalAlpha = runtime.status === 'downed' ? 0.45 : iframes ? 0.88 : 1;

    // === Soft breathing glow halo behind the ship for extra pop (skipped in perf mode) ===
    if (this.glowScale > 0 && runtime.status !== 'downed') {
      const breathe = 0.82 + Math.sin(t * 2.4) * 0.18;
      const haloR = r * 2.75 * breathe;
      const halo = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, haloR);
      halo.addColorStop(0, `rgba(140,220,255,${0.42 * this.glowScale * breathe})`);
      halo.addColorStop(0.45, `rgba(95,170,255,${0.18 * this.glowScale})`);
      halo.addColorStop(1, 'rgba(60,130,255,0)');
      ctx.save();
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // === Per-frame engine exhaust trails (drawn behind sprite) ===
    if (!this.fastRender && runtime.status !== 'downed') {
      const throb = 0.75 + Math.sin(t * 18) * 0.18 + Math.sin(t * 41) * 0.08;
      ctx.save();
      // Three exhaust plumes — center + two side engines
      const plumes: Array<[number, number, number]> = [
        [-r * 0.78, 0, 1.15],          // center thruster (biggest)
        [-r * 0.72, -r * 0.16, 0.9],   // port engine
        [-r * 0.72, r * 0.16, 0.9],    // starboard engine
      ];
      for (let pi = 0; pi < plumes.length; pi += 1) {
        const [px, py, scale] = plumes[pi];
        const len = r * 0.7 * scale * throb;
        // Quantize the throbbing length so a handful of gradients are reused
        // across frames instead of allocating three per frame. The throb-driven
        // alpha is reapplied via globalAlpha (all stop alphas scale linearly).
        const lenKey = Math.max(1, Math.round(len));
        const cacheKey = `${pi}:${lenKey}`;
        let grad = this.exhaustGradients.get(cacheKey);
        if (!grad) {
          const cx = px - lenKey * 0.4;
          grad = ctx.createRadialGradient(cx, py, 0, cx, py, lenKey);
          grad.addColorStop(0, 'rgba(220,240,255,0.85)');
          grad.addColorStop(0.35, 'rgba(120,180,255,0.5)');
          grad.addColorStop(0.7, 'rgba(60,120,220,0.18)');
          grad.addColorStop(1, 'rgba(40,80,200,0)');
          this.exhaustGradients.set(cacheKey, grad);
        }
        ctx.globalAlpha = throb;
        ctx.fillStyle = grad;
        if (this.glowScale > 0) {
          ctx.shadowColor = '#7ec8ff';
          ctx.shadowBlur = 12 * this.glowScale * throb;
        }
        ctx.beginPath();
        ctx.ellipse(px - len * 0.35, py, len * 0.55, r * 0.16 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    this.drawSprite(ctx, sprite, 0, 0, r * 4.2);

    // === Per-frame reactor seam pulse + nav lights (drawn over sprite, before iframes) ===
    if (!this.fastRender && runtime.status !== 'downed') {
      const r2 = r;   // sprite is drawn at scale r * 4.2; sprite uses unit = size/64 → r*4.2/64 ≈ same as r/15.2
      // Sprite-internal scale: the buildPlayer code uses r = 14 * unit where size=128, so unit=2; r_internal = 28.
      // We're drawing the sprite at world-space r*4.2 wide, so 1 internal unit ≈ r*4.2/128 = r/30.5.
      // For nav-light positioning we re-derive in world space at scale ~r:
      const baseR = r2;

      // Reactor seam pulse — bright cyan bar along the hull center
      const seamPulse = 0.55 + Math.sin(t * 6) * 0.3 + Math.sin(t * 13) * 0.15;
      ctx.save();
      if (this.glowScale > 0) {
        ctx.shadowColor = '#7ee8ff';
        ctx.shadowBlur = 10 * this.glowScale * seamPulse;
      }
      const seamGrad = ctx.createLinearGradient(-baseR * 0.6, 0, baseR * 1.0, 0);
      seamGrad.addColorStop(0, 'rgba(125,232,255,0)');
      seamGrad.addColorStop(0.5, `rgba(170,240,255,${0.85 * seamPulse})`);
      seamGrad.addColorStop(1, 'rgba(125,232,255,0)');
      ctx.fillStyle = seamGrad;
      ctx.fillRect(-baseR * 0.6, -baseR * 0.045, baseR * 1.6, baseR * 0.09);
      ctx.restore();

      // Wing-tip navigation lights — port (left = -y after rotation 0 = +y in sprite coords... wait)
      // The sprite is drawn rotated by facingAngle. The wing-tip baked dots are at sprite coords
      // (-r_internal * 0.55, ±r_internal * 1.02) which in our world-scale becomes roughly
      // (-baseR * 0.6, ±baseR * 1.12) given the 4.2x sprite scaling.
      const navX = -baseR * 0.6;
      const navY = baseR * 1.12;
      // Port light (sprite coord +y → starboard in standard convention; we use -y for port red here)
      const portBlink = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3.2));
      const stbdBlink = 0.35 + 0.65 * Math.max(0, Math.sin(t * 3.2 + Math.PI));
      ctx.save();
      if (this.glowScale > 0) {
        ctx.shadowBlur = 14 * this.glowScale * portBlink;
        ctx.shadowColor = '#ff5b6e';
      }
      ctx.fillStyle = `rgba(255,120,140,${portBlink})`;
      ctx.beginPath();
      ctx.arc(navX, -navY, baseR * 0.085, 0, Math.PI * 2);
      ctx.fill();
      if (this.glowScale > 0) {
        ctx.shadowBlur = 14 * this.glowScale * stbdBlink;
        ctx.shadowColor = '#5eff9c';
      }
      ctx.fillStyle = `rgba(110,255,160,${stbdBlink})`;
      ctx.beginPath();
      ctx.arc(navX, navY, baseR * 0.085, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Nose strobe (white, slow blink)
      const nose = 0.4 + 0.6 * Math.max(0, Math.sin(t * 1.6));
      ctx.save();
      if (this.glowScale > 0) {
        ctx.shadowBlur = 12 * this.glowScale * nose;
        ctx.shadowColor = '#ffffff';
      }
      ctx.fillStyle = `rgba(255,255,255,${nose * 0.9})`;
      ctx.beginPath();
      ctx.arc(baseR * 1.15, 0, baseR * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
    }

    // Invulnerability shimmer rings
    if (iframes) {
      const shimmerAlpha = clamp(player.invulnerableTimer / 0.9, 0, 1) * 0.85;
      ctx.shadowBlur = this.fastRender ? 0 : 10 * this.glowScale;

      ctx.save();
      ctx.rotate(t * 4);
      ctx.globalAlpha = shimmerAlpha;
      ctx.strokeStyle = '#a7f3d0';
      ctx.lineWidth = 2;
      if (this.glowScale > 0) ctx.shadowColor = '#a7f3d0';
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, (Math.PI * 2) / 3);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(-t * 5.2);
      ctx.globalAlpha = shimmerAlpha;
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 2;
      if (this.glowScale > 0) ctx.shadowColor = '#67e8f9';
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, Math.PI, Math.PI + (Math.PI * 2) / 3);
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(-player.facingAngle);
    ctx.shadowBlur = 0;

    if (runtime.status === 'downed') {
      const progress = clamp(runtime.reviveProgress / 3, 0, 1);
      ctx.strokeStyle = runtime.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Gradient baked at the origin with baseline (max) stop alphas; the per-particle
  // life alpha is reapplied via globalAlpha (all stop alphas scale linearly), and
  // the world position via translate. Keyed by integer radius so the cache stays
  // tiny (~12 entries) across the whole engine lifetime.
  private getDashTrailGradient(ctx: CanvasRenderingContext2D, radiusKey: number): CanvasGradient {
    let grad = this.dashTrailGradients.get(radiusKey);
    if (!grad) {
      grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusKey);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.5, 'rgba(168, 243, 255, 0.6)');
      grad.addColorStop(1, 'rgba(212, 84, 255, 0)');
      this.dashTrailGradients.set(radiusKey, grad);
    }
    return grad;
  }

  private drawDashTrail(ctx: CanvasRenderingContext2D): void {
    if (this.fastRender || this.dashTrail.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#a8f3ff';
    ctx.shadowBlur = 16 * this.glowScale;
    for (const s of this.dashTrail) {
      const lifeRatio = 1 - s.t / GameEngine.DASH_TRAIL_LIFE;
      if (lifeRatio <= 0) continue;
      const radius = 12 * lifeRatio + 4;
      const radiusKey = Math.max(1, Math.round(radius));
      ctx.globalAlpha = 0.7 * lifeRatio;
      ctx.fillStyle = this.getDashTrailGradient(ctx, radiusKey);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    for (const particle of this.state.particles) {
      if (!this.isCircleVisible(particle.position, particle.radius, viewport, 14)) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      if (!this.fastRender) {
        this.setGlow(ctx, 10, particle.color);
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(particle.position.x, particle.position.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawDamageTexts(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
    ctx.textAlign = 'center';
    ctx.font = '700 14px Inter, system-ui, sans-serif';

    for (const text of this.state.damageTexts) {
      if (!this.isCircleVisible(text.position, 4, viewport, 32)) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.fillStyle = text.color;
      if (!this.fastRender) {
        this.setGlow(ctx, 8, text.color);
      } else {
        ctx.shadowBlur = 0;
      }
      // Draw text if provided, otherwise draw amount (2a for streak text)
      const displayText = text.text !== undefined ? text.text : String(text.amount);
      ctx.fillText(displayText, text.position.x, text.position.y);
      ctx.restore();
    }
  }

  // 2d: Draw boss spawn cinematic
  private drawBossCinematic(ctx: CanvasRenderingContext2D, timer: number): void {
    if (timer > 1.9) {
      // Draw black letterbox bars (top/bottom 10% of canvas height)
      const barHeight = this.viewSize.height * 0.1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.viewSize.width, barHeight);
      ctx.fillRect(0, this.viewSize.height - barHeight, this.viewSize.width, barHeight);

      // Fade in over the full 0.6s pause (timer from 2.5 to 1.9)
      const fadeProgress = (2.5 - timer) / 0.6;
      const alpha = Math.min(1, Math.max(0, fadeProgress));

      // Draw centered red glowing text "NIGHT LICH AWAKENS" in large font
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 48px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff335f';
      if (!this.fastRender) {
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ff335f';
      }
      ctx.fillText('NIGHT LICH AWAKENS', this.viewSize.width / 2, this.viewSize.height / 2);
      ctx.restore();
    }

    // Fade out everything as timer decreases from 1.9 to 0
    if (timer < 1.9) {
      const opacity = timer / 1.9;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, this.viewSize.width, this.viewSize.height);
      ctx.restore();
    }
  }

  private drawVignette(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.getVignetteGradient(ctx);
    ctx.fillRect(0, 0, this.viewSize.width, this.viewSize.height);

    // 2f: Low HP canvas vignette. The gradient geometry is invariant per canvas
    // size, so it is cached once; only the per-frame pulse alpha varies, applied
    // via globalAlpha rather than rebuilding the gradient every frame.
    const hp = this.state.player.health / this.state.player.maxHealth;
    if (hp < 0.25) {
      const intensity = (0.25 - hp) / 0.25;
      const pulse = 0.5 + 0.5 * Math.sin(this.state.elapsed * 6);
      const alpha = intensity * pulse * 0.35;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = this.getLowHpVignetteGradient(ctx);
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    }
  }

  private getLowHpVignetteGradient(ctx: CanvasRenderingContext2D): CanvasGradient {
    const key = `${ctx.canvas.width}x${ctx.canvas.height}`;
    if (!this.lowHpVignetteGradient || this.lowHpVignetteKey !== key) {
      const grad = ctx.createRadialGradient(
        ctx.canvas.width / 2, ctx.canvas.height / 2, ctx.canvas.height * 0.3,
        ctx.canvas.width / 2, ctx.canvas.height / 2, ctx.canvas.height * 0.85
      );
      // Full-alpha stops; the per-frame intensity is applied with globalAlpha.
      grad.addColorStop(0, 'rgba(255,51,95,0)');
      grad.addColorStop(1, 'rgba(255,51,95,1)');
      this.lowHpVignetteGradient = grad;
      this.lowHpVignetteKey = key;
    }
    return this.lowHpVignetteGradient;
  }

  private drawHealthBarRounded(ctx: CanvasRenderingContext2D, width: number, height: number, y: number, ratio: number, isBoss: boolean): void {
    const x = -width / 2;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(8,4,18,0.85)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();

    if (ratio > 0) {
      const fillWidth = Math.max(height, width * ratio);
      const tier = ratio > 0.6 ? 2 : ratio > 0.3 ? 1 : 0;
      ctx.fillStyle = this.getHealthBarGradient(ctx, width, tier);
      ctx.beginPath();
      ctx.roundRect(x, y, fillWidth, height, height / 2);
      ctx.fill();
    }

    if (isBoss) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(0, y + height);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,209,102,0.53)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, height / 2);
      ctx.stroke();
    }
  }

  private applyHitSquash(ctx: CanvasRenderingContext2D, hitFlash: number): void {
    if (hitFlash > 0) {
      ctx.scale(1 + hitFlash * 0.6, 1 - hitFlash * 0.6);
    }
  }
}
