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

export interface DashState {
  charges: number;
  maxCharges: number;
  rechargeRemaining: number;
  rechargeDuration: number;
  active: boolean;
  activeRemaining: number;
  invulnRemaining: number;
  dirX: number;
  dirY: number;
  speed: number;
  hitIds: string[];
  queued: boolean;
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
  dash: DashState;
  dashDamageMult: number;
  dashRechargeMult: number;
  dashChargeBonus: number;
  lifestealOnKill: number;  // HP restored per heavy/elite/boss kill (Bloodlust passive; 0 = none)
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
export type ProjectileKind = 'bolt' | 'arrow' | 'pulse' | 'ranged' | 'missile';

export interface Projectile {
  id: string;
  owner: ProjectileOwner;
  ownerPlayerId?: string;
  weaponId?: WeaponId;  // weapon that created this projectile (for damage tracking)
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
  homingTurnRate?: number;  // rad/s a 'missile' steers toward the nearest enemy (undefined = no homing)
}

// String aliases — actual valid values live in src/game/content/*.registry.ts.
// Kept as named aliases so existing call sites read clearly without churn.
export type WeaponId = string;
export type PassiveId = string;
export type EvolutionId = string;

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
  currentWeaponLevel?: number;   // populated for weapon upgrades so UI can show "lv.2 → 3"
  statDelta?: string;            // human-readable delta e.g. "+22% ATK" for stat/passive upgrades
  rarity?: 'common' | 'rare' | 'epic';
}

export interface DamageText {
  id: string;
  position: Vector;
  velocity: Vector;
  amount: number;
  life: number;
  maxLife: number;
  color: string;
  text?: string;  // optional for streak/custom text display
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

export interface UpgradeAgency {
  rerolls: number;
  banishes: number;
  locks: number;
  maxRerolls: number;
  maxLocks: number;
}

export type GamePhase = 'menu' | 'playing' | 'paused' | 'levelUp' | 'chestReward' | 'gameOver' | 'victory';
export type PlayerStatus = 'active' | 'choosing' | 'downed' | 'disconnected';

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
  killStreak: number;            // current consecutive kill count
  killStreakExpiry: number;      // elapsed time when streak resets (streak resets after 3s)
  weaponDamageDealt: Record<string, number>;  // weapon id → total damage dealt this run
  upgradeHistory: string[];      // ordered list of upgrade titles collected
  cinematicState: null | { type: 'boss-spawn'; timer: number };
  timeScale: number;             // 1.0 normally; set to 0.35 briefly on level-up for time-slow feel
  agency: UpgradeAgency;         // remaining reroll/banish/lock for the current level-up screen
  bannedUpgradeIds: string[];    // banished upgrade ids — persist for the whole run
  lockedSlot: number | null;     // index of the card locked across rerolls (null = none)
  lastRunReward: number;         // shards earned on the most recent game-end transition (0 until run ends)
  walleted: boolean;             // guard: the run reward is credited to the wallet exactly once
}

export interface PlayerRuntime {
  id: string;
  name: string;
  color: string;
  status: PlayerStatus;
  player: Player;
  weapons: Weapon[];
  level: number;
  xp: number;
  xpToNext: number;
  upgradeChoices: UpgradeOption[];
  pendingChestChoices: UpgradeOption[];
  stats: GameStats;
  reviveProgress: number;
  killStreak: number;        // consecutive recent kills (drives Adrenal Surge in LAN)
  killStreakExpiry: number;  // elapsed time at which the streak resets
}

export interface PlayerCommand {
  type?: 'command';
  playerId: string;
  seq?: number;
  moveUp: boolean;
  moveDown: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  aimWorldX: number;
  aimWorldY: number;
  reviveHeld: boolean;
  dashHeld: boolean;
}

export interface MultiplayerGameState extends Omit<GameState, 'player' | 'weapons' | 'upgradeChoices' | 'pendingChestChoices' | 'level' | 'xp' | 'xpToNext' | 'stats'> {
  players: PlayerRuntime[];
}

export interface MultiplayerSnapshot {
  localPlayerId: string;
  state: MultiplayerGameState;
}
