export interface Vector {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArenaBounds {
  width: number;
  height: number;
}

export interface MovementInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface InputState extends MovementInput {
  mouse: Vector;
  mouseWorld: Vector;
}

export interface Player {
  position: Vector;
  radius: number;
  maxHealth: number;
  health: number;
  speed: number;
  damageMultiplier: number;
  attackRateMultiplier: number;
  pickupRadius: number;
  invulnerableTimer: number;
  facingAngle: number;
}

export type EnemyType = 'basic' | 'fast' | 'tank' | 'ranged' | 'boss';

export interface Enemy {
  id: string;
  type: EnemyType;
  position: Vector;
  velocity: Vector;
  radius: number;
  maxHealth: number;
  health: number;
  speed: number;
  damage: number;
  xpValue: number;
  color: string;
  cooldown: number;
  hitFlash: number;
}

export type ProjectileOwner = 'player' | 'enemy';
export type ProjectileKind = 'bolt' | 'arrow' | 'pulse' | 'ranged';

export interface Projectile {
  id: string;
  owner: ProjectileOwner;
  kind: ProjectileKind;
  position: Vector;
  velocity: Vector;
  radius: number;
  damage: number;
  life: number;
  maxLife: number;
  pierce: number;
  color: string;
  alpha?: number;
  maxRadius?: number;
  hitIds?: Set<string>;
}

export type WeaponId = 'magic-bolt' | 'orbit' | 'area-pulse' | 'piercing-arrow';

export interface Weapon {
  id: WeaponId;
  name: string;
  level: number;
  cooldown: number;
  fireRate: number;
  damage: number;
  range: number;
  unlocked: boolean;
}

export type UpgradeKind = 'stat' | 'weapon';

export interface UpgradeOption {
  id: string;
  title: string;
  description: string;
  kind: UpgradeKind;
  stat?: 'damage' | 'attackRate' | 'moveSpeed' | 'maxHealth' | 'pickupRadius';
  weaponId?: WeaponId;
}

export interface DamageText {
  id: string;
  position: Vector;
  velocity: Vector;
  amount: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface XPGem {
  id: string;
  position: Vector;
  value: number;
  radius: number;
  color: string;
  life: number;
}

export interface Particle {
  id: string;
  position: Vector;
  velocity: Vector;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

export type GamePhase = 'menu' | 'playing' | 'paused' | 'levelUp' | 'gameOver' | 'victory';

export interface GameStats {
  timeSurvived: number;
  kills: number;
  level: number;
  upgradesCollected: number;
  damageDealt: number;
}

export interface GameState {
  phase: GamePhase;
  player: Player;
  weapons: Weapon[];
  enemies: Enemy[];
  playerProjectiles: Projectile[];
  enemyProjectiles: Projectile[];
  gems: XPGem[];
  particles: Particle[];
  damageTexts: DamageText[];
  upgradeChoices: UpgradeOption[];
  level: number;
  xp: number;
  xpToNext: number;
  elapsed: number;
  difficultyTier: number;
  bossSpawned: boolean;
  arena: ArenaBounds;
  stats: GameStats;
  orbitAngle: number;
  screenShake: number;
}
