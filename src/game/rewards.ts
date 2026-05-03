import { EVOLUTIONS, PASSIVES, RARE_STAT_UPGRADES, STAT_UPGRADES } from './content';
import type { EvolutionId, Player, UpgradeOption, Weapon } from './types';

function pickOne<T>(items: T[], rng: () => number): T | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return items[Math.floor(rng() * items.length)];
}

function addUnique(choices: UpgradeOption[], choice: UpgradeOption | undefined): void {
  if (choice && !choices.some((item) => item.id === choice.id)) {
    choices.push(choice);
  }
}

function createWeaponChoices(weapons: Weapon[]): UpgradeOption[] {
  return weapons
    .filter((weapon) => weapon.id !== 'magic-bolt' || weapon.unlocked)
    .filter((weapon) => weapon.level < 6 && !weapon.evolved)
    .map<UpgradeOption>((weapon) => ({
      id: `weapon-${weapon.id}`,
      title: weapon.unlocked ? `${weapon.name} II+` : `Unlock ${weapon.name}`,
      description: weapon.unlocked ? `Increase ${weapon.name} power and uptime` : `Add ${weapon.name} to your arsenal`,
      kind: 'weapon',
      weaponId: weapon.id
    }));
}

function createPassiveChoices(player: Player): UpgradeOption[] {
  return PASSIVES
    .filter((passive) => (player.passives[passive.id] ?? 0) < passive.maxLevel)
    .map<UpgradeOption>((passive) => {
      const currentLevel = player.passives[passive.id] ?? 0;

      return {
        id: `passive-${passive.id}`,
        title: currentLevel > 0 ? `${passive.name} ${currentLevel + 1}` : passive.name,
        description: passive.description,
        kind: 'passive',
        passiveId: passive.id
      };
    });
}

export function getEligibleEvolutions(player: Player, weapons: Weapon[]) {
  return EVOLUTIONS.filter((evolution) => {
    const weapon = weapons.find((item) => item.id === evolution.weaponId);
    return Boolean(weapon?.unlocked && weapon.level >= 6 && !weapon.evolved && (player.passives[evolution.passiveId] ?? 0) >= 2);
  });
}

function createEvolutionOption(evolutionId: EvolutionId): UpgradeOption {
  const evolution = EVOLUTIONS.find((item) => item.id === evolutionId);

  if (!evolution) {
    throw new Error(`Unknown evolution: ${evolutionId}`);
  }

  return {
    id: `evolution-${evolution.id}`,
    title: evolution.name,
    description: evolution.description,
    kind: 'evolution',
    weaponId: evolution.weaponId,
    passiveId: evolution.passiveId,
    evolutionId: evolution.id
  };
}

export function createUpgradeChoices(player: Player, weapons: Weapon[], rng: () => number): UpgradeOption[] {
  const weaponChoices = createWeaponChoices(weapons);
  const passiveChoices = createPassiveChoices(player);
  const choices: UpgradeOption[] = [];

  addUnique(choices, pickOne(weaponChoices, rng));
  addUnique(choices, pickOne(passiveChoices, rng));

  const pool = [
    ...STAT_UPGRADES,
    ...weaponChoices,
    ...passiveChoices
  ].filter((choice) => !choices.some((selected) => selected.id === choice.id));

  while (choices.length < 3 && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const [choice] = pool.splice(index, 1);
    choices.push(choice);
  }

  return choices;
}

export function createChestRewardChoices(player: Player, weapons: Weapon[], rng: () => number): UpgradeOption[] {
  const choices: UpgradeOption[] = [];
  const eligibleEvolution = getEligibleEvolutions(player, weapons)[0];

  if (eligibleEvolution) {
    choices.push(createEvolutionOption(eligibleEvolution.id));
  }

  const pool = [
    ...RARE_STAT_UPGRADES,
    ...createWeaponChoices(weapons),
    ...createPassiveChoices(player)
  ].filter((choice) => !choices.some((selected) => selected.id === choice.id));

  while (choices.length < 3 && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const [choice] = pool.splice(index, 1);
    choices.push(choice);
  }

  return choices;
}

export function applyEvolution(weapons: Weapon[], evolutionId: EvolutionId): Weapon[] {
  const evolution = EVOLUTIONS.find((item) => item.id === evolutionId);

  if (!evolution) {
    return weapons;
  }

  return weapons.map((weapon) => {
    if (weapon.id !== evolution.weaponId) {
      return weapon;
    }

    return {
      ...weapon,
      evolved: true,
      evolutionId,
      level: Math.max(6, weapon.level),
      unlocked: true,
      cooldown: Math.min(weapon.cooldown, weapon.fireRate * 0.25)
    };
  });
}

export function applyUpgrade(player: Player, weapons: Weapon[], upgrade: UpgradeOption): { player: Player; weapons: Weapon[] } {
  if (upgrade.kind === 'evolution' && upgrade.evolutionId) {
    return { player, weapons: applyEvolution(weapons, upgrade.evolutionId) };
  }

  if (upgrade.kind === 'weapon' && upgrade.weaponId) {
    return {
      player,
      weapons: weapons.map((weapon) => {
        if (weapon.id !== upgrade.weaponId) {
          return weapon;
        }

        return {
          ...weapon,
          unlocked: true,
          level: Math.min(6, Math.max(1, weapon.level + 1)),
          cooldown: Math.min(weapon.cooldown, weapon.fireRate * 0.4)
        };
      })
    };
  }

  if (upgrade.kind === 'passive' && upgrade.passiveId) {
    const level = (player.passives[upgrade.passiveId] ?? 0) + 1;
    const passives = { ...player.passives, [upgrade.passiveId]: level };
    let nextPlayer: Player = { ...player, passives };

    if (upgrade.passiveId === 'cooldown-sigil') {
      nextPlayer = { ...nextPlayer, attackRateMultiplier: nextPlayer.attackRateMultiplier * 1.08 };
    } else if (upgrade.passiveId === 'astral-lens') {
      nextPlayer = { ...nextPlayer, pickupRadius: nextPlayer.pickupRadius + 20 };
    } else if (upgrade.passiveId === 'void-core') {
      nextPlayer = { ...nextPlayer, areaMultiplier: nextPlayer.areaMultiplier * 1.1 };
    } else if (upgrade.passiveId === 'keen-fletching') {
      nextPlayer = { ...nextPlayer, projectileSpeedMultiplier: nextPlayer.projectileSpeedMultiplier * 1.12 };
    }

    return { player: nextPlayer, weapons };
  }

  if (upgrade.stat === 'damage') {
    return { player: { ...player, damageMultiplier: player.damageMultiplier * (upgrade.id.startsWith('rare-') ? 1.24 : 1.18) }, weapons };
  }

  if (upgrade.stat === 'attackRate') {
    return { player: { ...player, attackRateMultiplier: player.attackRateMultiplier * 1.14 }, weapons };
  }

  if (upgrade.stat === 'moveSpeed') {
    return { player: { ...player, speed: player.speed * 1.1 }, weapons };
  }

  if (upgrade.stat === 'maxHealth') {
    const maxHealth = player.maxHealth + 24;

    return {
      player: {
        ...player,
        maxHealth,
        health: Math.min(maxHealth, player.health + 24)
      },
      weapons
    };
  }

  if (upgrade.stat === 'pickupRadius') {
    return { player: { ...player, pickupRadius: player.pickupRadius + 28 }, weapons };
  }

  if (upgrade.stat === 'area') {
    return { player: { ...player, areaMultiplier: player.areaMultiplier * 1.18 }, weapons };
  }

  if (upgrade.stat === 'projectileSpeed') {
    return { player: { ...player, projectileSpeedMultiplier: player.projectileSpeedMultiplier * 1.18 }, weapons };
  }

  return { player, weapons };
}
