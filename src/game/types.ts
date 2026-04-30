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
  passives: Partial<Record<PassiveId, number>>;
  areaMultiplier: number;
  projectileSpeedMultiplier: number;
  invulnerableTimer: number;
  facingAngle: number;
}

export type EnemyType = 'basic' | 'fast' | 'tank' | 'ranged' | 'boss';
export type EnemyRank = 'normal' | 'elite' | 'boss';

export interface Enemy {
  id: string;
  type: EnemyType;
  rank: EnemyRank;
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
export type PassiveId = 'cooldown-sigil' | 'astral-lens' | 'void-core' | 'keen-fletching';
export type EvolutionId = 'starfall-lance' | 'gravitic-halo' | 'supernova-bloom' | 'comet-volley';

export interface Weapon {
  id: WeaponId;
  name: string;
  level: number;
  cooldown: number;
  fireRate: number;
  damage: number;
  range: number;
  unlocked: boolean;
  evolved?: boolean;
  evolutionId?: EvolutionId;
  tags: string[];
}

export type UpgradeKind = 'stat' | 'weapon' | 'passive' | 'evolution';

export interface UpgradeOption {
  id: string;
  title: string;
  description: string;
  kind: UpgradeKind;
  stat?: 'damage' | 'attackRate' | 'moveSpeed' | 'maxHealth' | 'pickupRadius' | 'area' | 'projectileSpeed';
  weaponId?: WeaponId;
  passiveId?: PassiveId;
  evolutionId?: EvolutionId;
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

export interface HealthPickup {
  id: string;
  position: Vector;
  heal: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
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

export type ObjectiveStatus = 'active' | 'completed' | 'cursed';

export interface ObjectiveState {
  id: string;
  position: Vector;
  radius: number;
  spawnedAt: number;
  captureProgress: number;
  requiredCapture: number;
  ignoreAfter: number;
  state: ObjectiveStatus;
}

export interface RewardChest {
  id: string;
  position: Vector;
  radius: number;
  source: 'elite' | 'objective';
  opened: boolean;
  life: number;
}

export interface Telegraph {
  id: string;
  position: Vector;
  angle: number;
  width: number;
  length: number;
  life: number;
  maxLife: number;
  kind: 'line' | 'ring' | 'cone';
  color: string;
}

export interface RunDirectorState {
  spawnedElites: number[];
  spawnedObjectives: number[];
  bossSpawned: boolean;
}

export type GamePhase = 'menu' | 'playing' | 'paused' | 'levelUp' | 'chestReward' | 'gameOver' | 'victory';

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
  healthPickups: HealthPickup[];
  particles: Particle[];
  damageTexts: DamageText[];
  objectives: ObjectiveState[];
  rewardChests: RewardChest[];
  pendingChestChoices: UpgradeOption[];
  enemyCurseStacks: number;
  runDirector: RunDirectorState;
  telegraphs: Telegraph[];
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
