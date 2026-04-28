import type { Player, UpgradeOption, Weapon } from './types';

export function getXpThreshold(level: number): number {
  return Math.round(7 + level * 3.5 + Math.pow(level, 1.25) * 2.2);
}

const STAT_UPGRADES: UpgradeOption[] = [
  {
    id: 'stat-damage',
    title: 'Sharper Spells',
    description: '+18% weapon damage',
    kind: 'stat',
    stat: 'damage'
  },
  {
    id: 'stat-attack-rate',
    title: 'Quickened Casting',
    description: '+14% attack speed',
    kind: 'stat',
    stat: 'attackRate'
  },
  {
    id: 'stat-move-speed',
    title: 'Fleet Footwork',
    description: '+10% movement speed',
    kind: 'stat',
    stat: 'moveSpeed'
  },
  {
    id: 'stat-max-health',
    title: 'Blood Ward',
    description: '+24 max health and heal for 24',
    kind: 'stat',
    stat: 'maxHealth'
  },
  {
    id: 'stat-pickup-radius',
    title: 'Gem Magnet',
    description: '+28 pickup radius',
    kind: 'stat',
    stat: 'pickupRadius'
  }
];

export function createUpgradeChoices(_player: Player, weapons: Weapon[], rng: () => number): UpgradeOption[] {
  const weaponChoices = weapons
    .filter((weapon) => weapon.id !== 'magic-bolt' || weapon.unlocked)
    .map<UpgradeOption>((weapon) => ({
      id: `weapon-${weapon.id}`,
      title: weapon.unlocked ? `${weapon.name} II+` : `Unlock ${weapon.name}`,
      description: weapon.unlocked ? `Increase ${weapon.name} power and uptime` : `Add ${weapon.name} to your arsenal`,
      kind: 'weapon',
      weaponId: weapon.id
    }));
  const statChoices = [...STAT_UPGRADES];
  const choices: UpgradeOption[] = [];
  const availableWeapons = weaponChoices.filter((choice) => {
    const weapon = weapons.find((item) => item.id === choice.weaponId);
    return weapon ? weapon.level < 6 : false;
  });

  if (availableWeapons.length > 0) {
    choices.push(availableWeapons[Math.floor(rng() * availableWeapons.length)]);
  }

  const pool = [...statChoices, ...availableWeapons.filter((choice) => choice.id !== choices[0]?.id)];

  while (choices.length < 3 && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const [choice] = pool.splice(index, 1);
    choices.push(choice);
  }

  return choices;
}

export function applyUpgrade(player: Player, weapons: Weapon[], upgrade: UpgradeOption): { player: Player; weapons: Weapon[] } {
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

  if (upgrade.stat === 'damage') {
    return { player: { ...player, damageMultiplier: player.damageMultiplier * 1.18 }, weapons };
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

  return { player, weapons };
}
