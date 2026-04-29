import { angleTo, circlesOverlap, clamp, distance, normalizeVector, vectorFromAngle } from './collisions';
import { chooseEnemyType, getBossSpawn, spawnEnemyOutsideViewport, updateEnemies } from './enemies';
import { createDeathParticles, createXpGem, updateParticles } from './particles';
import { damagePlayer, setPlayerFacing, updatePlayerMovement } from './player';
import { resolveProjectileEnemyHit, updateProjectiles } from './projectiles';
import { createInitialGameState } from './state';
import { applyUpgrade, createUpgradeChoices, getXpThreshold } from './upgrades';
import { createAreaPulse, findNearestEnemy, fireWeaponAtTarget, getUnlockedWeapons } from './weapons';
import type { DamageText, Enemy, GamePhase, GameState, InputState, Projectile, UpgradeOption, Vector, Viewport, Weapon } from './types';

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
}

const BOSS_SPAWN_TIME = 300;
const MIN_SPAWN_INTERVAL = 0.26;

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
  private rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  startRun(): void {
    this.state = createInitialGameState();
    this.state.phase = 'playing';
    this.spawnTimer = 0.2;
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

  selectUpgrade(upgradeId: string): void {
    if (this.state.phase !== 'levelUp') {
      return;
    }

    const choice = this.state.upgradeChoices.find((upgrade) => upgrade.id === upgradeId);

    if (!choice) {
      return;
    }

    const upgraded = applyUpgrade(this.state.player, this.state.weapons, choice);
    this.state.player = upgraded.player;
    this.state.weapons = upgraded.weapons;
    this.state.stats.upgradesCollected += 1;
    this.state.upgradeChoices = [];
    this.state.phase = 'playing';
  }

  update(dt: number): void {
    const cappedDt = Math.min(0.05, Math.max(0, dt));

    if (this.state.phase !== 'playing') {
      return;
    }

    this.state.elapsed += cappedDt;
    this.state.stats.timeSurvived = this.state.elapsed;
    this.state.difficultyTier = Math.floor(this.state.elapsed / 30);
    this.state.screenShake = Math.max(0, this.state.screenShake - cappedDt * 24);
    this.input.mouseWorld = this.screenToWorld(this.input.mouse);
    this.updatePlayer(cappedDt);
    this.spawnEnemies(cappedDt);
    this.updateWeapons(cappedDt);
    this.state.enemies = updateEnemies(this.state.enemies, this.state.player.position, cappedDt);
    this.updateRangedEnemies(cappedDt);
    this.state.playerProjectiles = updateProjectiles(this.state.playerProjectiles, cappedDt);
    this.state.enemyProjectiles = updateProjectiles(this.state.enemyProjectiles, cappedDt);
    this.resolveCombat();
    this.updateGems(cappedDt);
    this.updateEffects(cappedDt);
    this.checkEndStates();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const viewport = this.getViewport();
    const shake = this.state.screenShake > 0 ? this.state.screenShake : 0;
    const shakeOffset = {
      x: (this.rng() - 0.5) * shake,
      y: (this.rng() - 0.5) * shake
    };

    ctx.clearRect(0, 0, this.viewSize.width, this.viewSize.height);
    this.drawBackdrop(ctx);

    ctx.save();
    ctx.translate(shakeOffset.x - viewport.x, shakeOffset.y - viewport.y);
    this.drawArena(ctx);
    this.drawGems(ctx);
    this.drawProjectiles(ctx, this.state.playerProjectiles);
    this.drawProjectiles(ctx, this.state.enemyProjectiles);
    this.drawEnemies(ctx);
    this.drawOrbitWeapon(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    this.drawDamageTexts(ctx);
    ctx.restore();

    this.drawVignette(ctx);
  }

  getSnapshot(): GameSnapshot {
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
      bossSpawned: this.state.bossSpawned
    };
  }

  private updatePlayer(dt: number): void {
    this.state.player = updatePlayerMovement(this.state.player, this.input, dt, this.state.arena);
    this.state.player = setPlayerFacing(this.state.player, this.input.mouseWorld);
  }

  private spawnEnemies(dt: number): void {
    this.spawnTimer -= dt;

    if (!this.state.bossSpawned && this.state.elapsed >= BOSS_SPAWN_TIME) {
      this.state.enemies.push(getBossSpawn(this.getViewport(), this.state.difficultyTier));
      this.state.bossSpawned = true;
      this.state.screenShake = 18;
    }

    if (this.spawnTimer > 0) {
      return;
    }

    const tier = this.state.difficultyTier;
    const interval = Math.max(MIN_SPAWN_INTERVAL, 1.35 - tier * 0.06);
    const packSize = 1 + Math.floor(tier / 2) + (this.rng() < Math.min(0.7, tier * 0.08) ? 1 : 0);
    const viewport = this.getViewport(160);

    for (let index = 0; index < packSize; index += 1) {
      const type = chooseEnemyType(this.state.elapsed, tier, this.rng);
      this.state.enemies.push(spawnEnemyOutsideViewport(type, viewport, tier, this.rng));
    }

    this.spawnTimer = interval;
  }

  private updateWeapons(dt: number): void {
    const projectiles: Projectile[] = [];

    this.state.orbitAngle += dt * 2.8;
    this.state.weapons = this.state.weapons.map((weapon) => ({
      ...weapon,
      cooldown: Math.max(0, weapon.cooldown - dt * this.state.player.attackRateMultiplier)
    }));

    this.state.weapons = this.state.weapons.map((weapon) => {
      if (!weapon.unlocked || weapon.level <= 0) {
        return weapon;
      }

      if (weapon.id === 'orbit') {
        return this.resolveOrbitHits(weapon);
      }

      if (weapon.cooldown > 0) {
        return weapon;
      }

      if (weapon.id === 'area-pulse') {
        projectiles.push(createAreaPulse(weapon, this.state.player));
        return {
          ...weapon,
          cooldown: Math.max(0.7, weapon.fireRate * Math.pow(0.9, weapon.level - 1))
        };
      }

      const target = findNearestEnemy(this.state.enemies, this.state.player.position, weapon.range);

      if (!target) {
        return weapon;
      }

      projectiles.push(...fireWeaponAtTarget(weapon, this.state.player, target));

      return {
        ...weapon,
        cooldown: Math.max(0.16, weapon.fireRate * Math.pow(0.88, weapon.level - 1))
      };
    });

    this.state.playerProjectiles.push(...projectiles);
  }

  private resolveOrbitHits(weapon: Weapon): Weapon {
    if (weapon.cooldown > 0) {
      return weapon;
    }

    const bladeCount = 1 + Math.floor((weapon.level + 1) / 2);
    const orbitRadius = weapon.range + weapon.level * 9;
    const bladeRadius = 13 + weapon.level;
    let hit = false;

    this.state.enemies = this.state.enemies.map((enemy) => {
      for (let index = 0; index < bladeCount; index += 1) {
        const angle = this.state.orbitAngle + (Math.PI * 2 * index) / bladeCount;
        const bladePosition = {
          x: this.state.player.position.x + Math.cos(angle) * orbitRadius,
          y: this.state.player.position.y + Math.sin(angle) * orbitRadius
        };

        if (circlesOverlap(bladePosition, bladeRadius, enemy.position, enemy.radius)) {
          hit = true;
          const damage = Math.round(weapon.damage * this.state.player.damageMultiplier * (1 + weapon.level * 0.28));
          this.state.damageTexts.push(this.createDamageText(enemy, damage, '#f0abfc'));
          this.state.stats.damageDealt += damage;

          return {
            ...enemy,
            health: Math.max(0, enemy.health - damage),
            hitFlash: 0.12
          };
        }
      }

      return enemy;
    });

    return {
      ...weapon,
      cooldown: hit ? 0.18 : 0
    };
  }

  private updateRangedEnemies(_dt: number): void {
    const shots: Projectile[] = [];

    this.state.enemies = this.state.enemies.map((enemy) => {
      if ((enemy.type !== 'ranged' && enemy.type !== 'boss') || enemy.cooldown > 0) {
        return enemy;
      }

      const angle = angleTo(enemy.position, this.state.player.position);
      const spreadCount = enemy.type === 'boss' ? 3 : 1;

      for (let index = 0; index < spreadCount; index += 1) {
        const offset = spreadCount === 1 ? 0 : (index - 1) * 0.24;
        shots.push({
          id: `enemy-shot-${enemy.id}-${this.state.elapsed}-${index}`,
          owner: 'enemy',
          kind: 'ranged',
          position: { ...enemy.position },
          velocity: vectorFromAngle(angle + offset, enemy.type === 'boss' ? 230 : 190),
          radius: enemy.type === 'boss' ? 8 : 6,
          damage: enemy.damage,
          life: 3.5,
          maxLife: 3.5,
          pierce: 1,
          color: enemy.type === 'boss' ? '#ff5d73' : '#ffd166'
        });
      }

      return {
        ...enemy,
        cooldown: enemy.type === 'boss' ? 1.35 : 2.2
      };
    });

    this.state.enemyProjectiles.push(...shots);
  }

  private resolveCombat(): void {
    this.resolvePlayerProjectiles();
    this.resolveEnemyProjectiles();
    this.resolveEnemyContact();
    this.collectDeadEnemies();
  }

  private resolvePlayerProjectiles(): void {
    const nextProjectiles: Projectile[] = [];

    for (let projectile of this.state.playerProjectiles) {
      for (let index = 0; index < this.state.enemies.length; index += 1) {
        const enemy = this.state.enemies[index];

        if (projectile.hitIds?.has(enemy.id)) {
          continue;
        }

        if (!circlesOverlap(projectile.position, projectile.radius, enemy.position, enemy.radius)) {
          continue;
        }

        projectile.hitIds?.add(enemy.id);
        const result = resolveProjectileEnemyHit(projectile, enemy);
        projectile = result.projectile;
        this.state.enemies[index] = result.enemy;
        this.state.damageTexts.push(result.damageText);
        this.state.stats.damageDealt += result.damageText.amount;

        if (projectile.pierce <= 0) {
          break;
        }
      }

      if (projectile.pierce > 0 && projectile.life > 0) {
        nextProjectiles.push(projectile);
      }
    }

    this.state.playerProjectiles = nextProjectiles;
  }

  private resolveEnemyProjectiles(): void {
    const nextProjectiles: Projectile[] = [];

    for (const projectile of this.state.enemyProjectiles) {
      if (circlesOverlap(projectile.position, projectile.radius, this.state.player.position, this.state.player.radius)) {
        const result = damagePlayer(this.state.player, projectile.damage);
        this.state.player = result.player;
        this.state.screenShake = result.tookDamage ? 15 : this.state.screenShake;
        continue;
      }

      nextProjectiles.push(projectile);
    }

    this.state.enemyProjectiles = nextProjectiles;
  }

  private resolveEnemyContact(): void {
    for (const enemy of this.state.enemies) {
      if (!circlesOverlap(enemy.position, enemy.radius, this.state.player.position, this.state.player.radius)) {
        continue;
      }

      const result = damagePlayer(this.state.player, enemy.damage);
      this.state.player = result.player;
      this.state.screenShake = result.tookDamage ? 18 : this.state.screenShake;
    }
  }

  private collectDeadEnemies(): void {
    const survivors: Enemy[] = [];

    for (const enemy of this.state.enemies) {
      if (enemy.health > 0) {
        survivors.push(enemy);
        continue;
      }

      this.state.stats.kills += 1;
      this.state.gems.push(createXpGem(enemy));
      this.state.particles.push(...createDeathParticles(enemy, this.rng));
      this.state.screenShake = Math.max(this.state.screenShake, enemy.type === 'boss' ? 24 : 5);

      if (enemy.type === 'boss') {
        this.state.phase = 'victory';
      }
    }

    this.state.enemies = survivors;
  }

  private updateGems(dt: number): void {
    const remaining = [];

    for (const gem of this.state.gems) {
      const gemDistance = distance(gem.position, this.state.player.position);
      const magnetRange = this.state.player.pickupRadius * 3.2;
      let position = { ...gem.position };

      if (gemDistance < magnetRange) {
        const direction = normalizeVector({
          x: this.state.player.position.x - gem.position.x,
          y: this.state.player.position.y - gem.position.y
        });
        const speed = 240 + (1 - gemDistance / magnetRange) * 520;
        position = {
          x: gem.position.x + direction.x * speed * dt,
          y: gem.position.y + direction.y * speed * dt
        };
      }

      if (circlesOverlap(position, gem.radius, this.state.player.position, this.state.player.radius + this.state.player.pickupRadius * 0.16)) {
        this.state.xp += gem.value;
        this.resolveLevelUp();
        continue;
      }

      remaining.push({
        ...gem,
        position,
        life: gem.life + dt
      });
    }

    this.state.gems = remaining;
  }

  private resolveLevelUp(): void {
    while (this.state.xp >= this.state.xpToNext) {
      this.state.xp -= this.state.xpToNext;
      this.state.level += 1;
      this.state.stats.level = this.state.level;
      this.state.xpToNext = getXpThreshold(this.state.level);
      this.state.upgradeChoices = createUpgradeChoices(this.state.player, this.state.weapons, this.rng);
      this.state.phase = 'levelUp';
      this.state.screenShake = 8;
      break;
    }
  }

  private updateEffects(dt: number): void {
    this.state.particles = updateParticles(this.state.particles, dt);
    this.state.damageTexts = this.state.damageTexts
      .map((text) => ({
        ...text,
        position: {
          x: text.position.x + text.velocity.x * dt,
          y: text.position.y + text.velocity.y * dt
        },
        life: text.life - dt
      }))
      .filter((text) => text.life > 0);
  }

  private checkEndStates(): void {
    if (this.state.player.health <= 0) {
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

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, this.viewSize.width, this.viewSize.height);
    gradient.addColorStop(0, '#050711');
    gradient.addColorStop(0.55, '#101628');
    gradient.addColorStop(1, '#180c1c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.viewSize.width, this.viewSize.height);
  }

  private drawArena(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#070914';
    ctx.fillRect(0, 0, this.state.arena.width, this.state.arena.height);

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#1f4963';
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.state.arena.width; x += 96) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.state.arena.height);
      ctx.stroke();
    }

    for (let y = 0; y <= this.state.arena.height; y += 96) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.state.arena.width, y);
      ctx.stroke();
    }

    ctx.restore();
    ctx.strokeStyle = '#5eead455';
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, this.state.arena.width, this.state.arena.height);
  }

  private drawGems(ctx: CanvasRenderingContext2D): void {
    for (const gem of this.state.gems) {
      const pulse = Math.sin(gem.life * 8) * 0.18 + 1;
      ctx.save();
      ctx.translate(gem.position.x, gem.position.y);
      ctx.rotate(Math.PI / 4);
      ctx.shadowBlur = 16;
      ctx.shadowColor = gem.color;
      ctx.fillStyle = gem.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-gem.radius * pulse, -gem.radius * pulse, gem.radius * 2 * pulse, gem.radius * 2 * pulse);
      ctx.restore();
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    for (const projectile of projectiles) {
      ctx.save();
      ctx.globalAlpha = projectile.alpha ?? 1;
      ctx.shadowBlur = projectile.kind === 'pulse' ? 24 : 14;
      ctx.shadowColor = projectile.color;
      ctx.strokeStyle = projectile.color;
      ctx.fillStyle = projectile.color;

      if (projectile.kind === 'pulse') {
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(projectile.position.x, projectile.position.y, projectile.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (projectile.kind === 'arrow') {
        const angle = Math.atan2(projectile.velocity.y, projectile.velocity.x);
        ctx.translate(projectile.position.x, projectile.position.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-12, -5);
        ctx.lineTo(-7, 0);
        ctx.lineTo(-12, 5);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(projectile.position.x, projectile.position.y, projectile.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D): void {
    for (const enemy of this.state.enemies) {
      ctx.save();
      ctx.translate(enemy.position.x, enemy.position.y);

      switch (enemy.type) {
        case 'basic': this.drawBasicEnemy(ctx, enemy); break;
        case 'fast': this.drawFastEnemy(ctx, enemy); break;
        case 'tank': this.drawTankEnemy(ctx, enemy); break;
        case 'ranged': this.drawRangedEnemy(ctx, enemy); break;
        case 'boss': this.drawBossEnemy(ctx, enemy); break;
      }

      if (enemy.health < enemy.maxHealth || enemy.type === 'boss') {
        this.drawEnemyHealth(ctx, enemy);
      }

      ctx.restore();
    }
  }

  private drawBasicEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = enemy.radius;
    const t = this.state.elapsed;
    const idHash = enemy.id.charCodeAt(enemy.id.length - 1);
    const haloAlpha = 0.8 + Math.sin(t * 3 + idHash) * 0.2;
    const px = this.state.player.position.x;
    const py = this.state.player.position.y;

    // Halo
    ctx.save();
    ctx.globalAlpha = haloAlpha;
    this.drawRadialGlow(ctx, r * 0.3, r * 1.9, 'rgba(124,247,255,0.5)', 'rgba(124,247,255,0)');
    ctx.restore();

    // Body
    const bodyGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    bodyGrad.addColorStop(0, '#0a3a44');
    bodyGrad.addColorStop(0.6, '#1ec9d6');
    bodyGrad.addColorStop(1, '#7cf7ff');
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#7cf7ff';
    ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(186,252,255,0.67)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Eyes oriented toward player
    const dx = px - enemy.position.x;
    const dy = py - enemy.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const aimX = dx / len;
    const aimY = dy / len;
    const perpX = -aimY;
    const perpY = aimX;
    const eyeOffset = r * 0.35;
    const eyeR = r * 0.14;

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0b0f1a';

    for (const side of [-1, 1]) {
      const ex = aimX * eyeOffset + perpX * side * r * 0.28;
      const ey = aimY * eyeOffset + perpY * side * r * 0.28;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(ex + eyeR * 0.3, ey - eyeR * 0.3, eyeR * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0f1a';
    }
  }

  private drawFastEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = enemy.radius;
    const t = this.state.elapsed;
    const idHash = enemy.id.charCodeAt(enemy.id.length - 1);
    const speed = Math.hypot(enemy.velocity.x, enemy.velocity.y);
    const angle = speed > 1
      ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
      : Math.atan2(
          this.state.player.position.y - enemy.position.y,
          this.state.player.position.x - enemy.position.x
        );

    // Motion trail (only when moving fast)
    if (speed > 90) {
      ctx.save();
      for (let k = 1; k <= 3; k++) {
        const tx = (-enemy.velocity.x / speed) * r * k * 0.55;
        const ty = (-enemy.velocity.y / speed) * r * k * 0.55;
        ctx.globalAlpha = 0.45 * (1 - k / 4);
        ctx.fillStyle = '#ff5edb';
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(r * 1.2, 0);
        ctx.lineTo(-r * 0.7, -r * 0.85);
        ctx.lineTo(-r * 0.25, 0);
        ctx.lineTo(-r * 0.7, r * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // Body chevron
    ctx.save();
    ctx.rotate(angle);

    const prowGrad = ctx.createLinearGradient(-r * 0.7, 0, r * 1.2, 0);
    prowGrad.addColorStop(0, '#ff5edb');
    prowGrad.addColorStop(1, '#ffb8f0');
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#ff5edb';
    ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : prowGrad;
    ctx.strokeStyle = 'rgba(255,232,250,0.67)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r * 1.2, 0);
    ctx.lineTo(-r * 0.7, -r * 0.85);
    ctx.lineTo(-r * 0.25, 0);
    ctx.lineTo(-r * 0.7, r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Tail spark
    const sparkScale = 0.85 + Math.sin(t * 8 + idHash) * 0.15;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#fff7ad';
    ctx.fillStyle = '#fff7ad';
    ctx.beginPath();
    ctx.arc(-r * 0.7, 0, r * 0.18 * sparkScale, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawTankEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    ctx.shadowBlur = 18;
    ctx.shadowColor = enemy.color;
    ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : enemy.color;
    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 2;
    this.drawPolygon(ctx, enemy.radius, 6, this.state.elapsed * 0.7);
  }

  private drawRangedEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    ctx.shadowBlur = 18;
    ctx.shadowColor = enemy.color;
    ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : enemy.color;
    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 2;
    this.drawPolygon(ctx, enemy.radius, 4, Math.PI / 4);
  }

  private drawBossEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    ctx.shadowBlur = 32;
    ctx.shadowColor = enemy.color;
    ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : enemy.color;
    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, enemy.radius + 12 + Math.sin(this.state.elapsed * 4) * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#18040c';
    ctx.beginPath();
    ctx.arc(-16, -8, 7, 0, Math.PI * 2);
    ctx.arc(16, -8, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEnemyHealth(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const width = enemy.type === 'boss' ? 130 : 42;
    const y = -enemy.radius - 18;
    const ratio = clamp(enemy.health / enemy.maxHealth, 0, 1);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#180d16';
    ctx.fillRect(-width / 2, y, width, 5);
    ctx.fillStyle = enemy.type === 'boss' ? '#ff335f' : '#5eead4';
    ctx.fillRect(-width / 2, y, width * ratio, 5);
  }

  private drawOrbitWeapon(ctx: CanvasRenderingContext2D): void {
    const weapon = this.state.weapons.find((item) => item.id === 'orbit' && item.unlocked);

    if (!weapon) {
      return;
    }

    const bladeCount = 1 + Math.floor((weapon.level + 1) / 2);
    const orbitRadius = weapon.range + weapon.level * 9;

    for (let index = 0; index < bladeCount; index += 1) {
      const angle = this.state.orbitAngle + (Math.PI * 2 * index) / bladeCount;
      const position = {
        x: this.state.player.position.x + Math.cos(angle) * orbitRadius,
        y: this.state.player.position.y + Math.sin(angle) * orbitRadius
      };
      ctx.save();
      ctx.translate(position.x, position.y);
      ctx.rotate(angle);
      ctx.shadowBlur = 18;
      ctx.shadowColor = '#f0abfc';
      ctx.fillStyle = '#f0abfc';
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const player = this.state.player;
    const r = player.radius;
    const t = this.state.elapsed;
    const iframes = player.invulnerableTimer > 0;

    ctx.save();
    ctx.translate(player.position.x, player.position.y);

    // Ground shadow blob (before rotate, stays flat)
    this.drawShadowBlob(ctx, r * 1.05, r * 0.32, r * 0.55, 0.45);

    ctx.rotate(player.facingAngle);
    ctx.globalAlpha = iframes ? 0.88 : 1;

    // Outer halo (radial gradient, no shadowBlur)
    const haloAlpha = 0.85 + Math.sin(t * 2.4) * 0.15;
    ctx.save();
    ctx.globalAlpha = (iframes ? 0.88 : 1) * haloAlpha;
    this.drawRadialGlow(ctx, r * 0.4, r * 2.4, 'rgba(94,234,212,0.55)', 'rgba(94,234,212,0)');
    ctx.restore();

    // Mid hull
    const hullGrad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
    hullGrad.addColorStop(0, '#1b2840');
    hullGrad.addColorStop(0.7, '#122036');
    hullGrad.addColorStop(1, '#0a1426');
    ctx.fillStyle = hullGrad;
    ctx.shadowBlur = 14;
    ctx.shadowColor = '#5eead4';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner core (pulsing)
    const coreScale = 1 + Math.sin(t * 3) * 0.06;
    const coreR = r * 0.5 * coreScale;
    ctx.shadowBlur = 0;
    this.drawRadialGlow(ctx, 0, coreR, '#d3fff5', 'rgba(94,234,212,0)');

    // Directional prow (replaces flat triangle)
    const prowGrad = ctx.createLinearGradient(r * 0.2, 0, r + 12, 0);
    prowGrad.addColorStop(0, '#ffd166');
    prowGrad.addColorStop(1, '#fff3b0');
    ctx.fillStyle = prowGrad;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ffd166';
    ctx.strokeStyle = 'rgba(255,243,176,0.67)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r + 12, 0);
    ctx.lineTo(r * 0.2, -r * 0.55);
    ctx.lineTo(r * 0.5, 0);
    ctx.lineTo(r * 0.2, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Invulnerability shimmer rings
    if (iframes) {
      const shimmerAlpha = clamp(player.invulnerableTimer / 0.9, 0, 1) * 0.85;
      ctx.shadowBlur = 10;

      ctx.save();
      ctx.rotate(t * 4);
      ctx.globalAlpha = shimmerAlpha;
      ctx.strokeStyle = '#a7f3d0';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#a7f3d0';
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, 0, (Math.PI * 2) / 3);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(-t * 5.2);
      ctx.globalAlpha = shimmerAlpha;
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#67e8f9';
      ctx.beginPath();
      ctx.arc(0, 0, r + 6, Math.PI, Math.PI + (Math.PI * 2) / 3);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.state.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(particle.position.x, particle.position.y, particle.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawDamageTexts(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.font = '700 14px Inter, system-ui, sans-serif';

    for (const text of this.state.damageTexts) {
      ctx.save();
      ctx.globalAlpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.fillStyle = text.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = text.color;
      ctx.fillText(String(text.amount), text.position.x, text.position.y);
      ctx.restore();
    }
  }

  private drawPolygon(ctx: CanvasRenderingContext2D, radius: number, sides: number, rotation: number): void {
    ctx.beginPath();

    for (let index = 0; index < sides; index += 1) {
      const angle = rotation + (Math.PI * 2 * index) / sides;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawVignette(ctx: CanvasRenderingContext2D): void {
    const radius = Math.max(this.viewSize.width, this.viewSize.height) * 0.72;
    const gradient = ctx.createRadialGradient(this.viewSize.width / 2, this.viewSize.height / 2, radius * 0.2, this.viewSize.width / 2, this.viewSize.height / 2, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.viewSize.width, this.viewSize.height);
  }

  private drawRadialGlow(ctx: CanvasRenderingContext2D, innerR: number, outerR: number, innerColor: string, outerColor = 'rgba(0,0,0,0)'): void {
    const g = ctx.createRadialGradient(0, 0, innerR, 0, 0, outerR);
    g.addColorStop(0, innerColor);
    g.addColorStop(1, outerColor);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawShadowBlob(ctx: CanvasRenderingContext2D, rx: number, ry: number, yOffset: number, alpha = 0.45): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000000';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(0, yOffset, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawGradientPolygon(ctx: CanvasRenderingContext2D, radius: number, sides: number, rotation: number, fill: CanvasGradient | string, stroke?: string, lineWidth = 2): void {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (Math.PI * 2 * i) / sides;
      if (i === 0) {
        ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      } else {
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke !== undefined) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
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
      const grad = ctx.createLinearGradient(x, 0, x + width, 0);

      if (ratio > 0.6) {
        grad.addColorStop(0, '#5eead4');
        grad.addColorStop(1, '#38bdf8');
      } else if (ratio > 0.3) {
        grad.addColorStop(0, '#fde68a');
        grad.addColorStop(1, '#f59e0b');
      } else {
        grad.addColorStop(0, '#fb7185');
        grad.addColorStop(1, '#ef4444');
      }

      ctx.fillStyle = grad;
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

  private drawHitImpact(ctx: CanvasRenderingContext2D, radius: number, hitFlash: number): void {
    if (hitFlash <= 0) return;
    const progress = (0.12 - hitFlash) / 0.12;
    ctx.save();
    ctx.globalAlpha = hitFlash / 0.12;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, radius * (1 + progress), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private applyHitSquash(ctx: CanvasRenderingContext2D, hitFlash: number): void {
    if (hitFlash > 0) {
      ctx.scale(1 + hitFlash * 0.6, 1 - hitFlash * 0.6);
    }
  }
}
