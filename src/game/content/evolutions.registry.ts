export interface EvolutionDef {
  id: string;
  name: string;
  description: string;
  weaponId: string;
  passiveId: string;
  weaponLevelRequired: number;
  passiveLevelRequired: number;
}

export const EVOLUTIONS: Record<string, EvolutionDef> = {
  'starfall-lance': {
    id: 'starfall-lance',
    name: 'Starfall Lance',
    description: 'Magic Bolt pierces harder and blooms into sparks on hit',
    weaponId: 'magic-bolt',
    passiveId: 'cooldown-sigil',
    weaponLevelRequired: 5,
    passiveLevelRequired: 1,
  },
  'gravitic-halo': {
    id: 'gravitic-halo',
    name: 'Gravitic Halo',
    description: 'Astral Orbit grows wider, strikes faster, and slows enemies',
    weaponId: 'orbit',
    passiveId: 'astral-lens',
    weaponLevelRequired: 5,
    passiveLevelRequired: 1,
  },
  'supernova-bloom': {
    id: 'supernova-bloom',
    name: 'Supernova Bloom',
    description: 'Area Pulse leaves a lingering damaging ring',
    weaponId: 'area-pulse',
    passiveId: 'void-core',
    weaponLevelRequired: 5,
    passiveLevelRequired: 1,
  },
  'comet-volley': {
    id: 'comet-volley',
    name: 'Comet Volley',
    description: 'Piercing Arrow becomes a high-speed three-arrow fan',
    weaponId: 'piercing-arrow',
    passiveId: 'keen-fletching',
    weaponLevelRequired: 5,
    passiveLevelRequired: 1,
  },
};
