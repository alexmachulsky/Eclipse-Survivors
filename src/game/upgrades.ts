export { applyUpgrade, createChestRewardChoices, createUpgradeChoices, getEligibleEvolutions } from './rewards';

export function getXpThreshold(level: number): number {
  return Math.round(7 + level * 3.5 + Math.pow(level, 1.25) * 2.2);
}
