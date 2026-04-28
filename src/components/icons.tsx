import type { WeaponId } from '../game/types';

interface IconProps {
  size?: number;
  color?: string;
}

export function MagicBoltIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13,2 7,13 12,13 11,22 18,9 13,9 13,2" />
    </svg>
  );
}

export function OrbitIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-20 12 12)" />
    </svg>
  );
}

export function AreaPulseIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" fill={color} stroke="none" />
      <circle cx="12" cy="12" r="6" strokeDasharray="4 4" />
      <circle cx="12" cy="12" r="10" strokeDasharray="4 4" opacity="0.5" />
    </svg>
  );
}

export function PiercingArrowIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14,6 20,12 14,18" />
      <line x1="4" y1="9" x2="8" y2="9" opacity="0.5" />
      <line x1="4" y1="15" x2="8" y2="15" opacity="0.5" />
    </svg>
  );
}

export function DamageIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="17" y2="7" />
      <line x1="10.5" y1="5.5" x2="14.5" y2="9.5" />
      <line x1="13" y1="4" x2="8" y2="9" />
      <circle cx="18" cy="6" r="2" />
    </svg>
  );
}

export function AttackRateIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <polyline points="12,13 12,8" />
      <polyline points="12,13 16,11" />
    </svg>
  );
}

export function MoveSpeedIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="7" x2="8" y2="7" />
      <line x1="1" y1="12" x2="7" y2="12" />
      <line x1="2" y1="17" x2="8" y2="17" />
      <polyline points="12,5 20,12 12,19" />
    </svg>
  );
}

export function MaxHealthIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      <line x1="12" y1="9" x2="12" y2="15" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  );
}

export function PickupRadiusIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h2a2 2 0 0 1 2 2v8a2 2 0 0 0 4 0V6a2 2 0 0 1 2-2h2" />
      <line x1="6" y1="4" x2="6" y2="7" />
      <line x1="18" y1="4" x2="18" y2="7" />
    </svg>
  );
}

export function HeartIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function StarIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
    </svg>
  );
}

export function ClockIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

export function SkullIcon({ size = 24, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.3 6H8.3C6.3 15.7 5 13.5 5 11a7 7 0 0 1 7-7z" />
      <line x1="9" y1="17" x2="9" y2="21" />
      <line x1="15" y1="17" x2="15" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
      <circle cx="9.5" cy="10.5" r="1" fill={color} stroke="none" />
      <circle cx="14.5" cy="10.5" r="1" fill={color} stroke="none" />
    </svg>
  );
}

export const WeaponIconMap: Record<WeaponId, (props: IconProps) => JSX.Element> = {
  'magic-bolt': MagicBoltIcon,
  'orbit': OrbitIcon,
  'area-pulse': AreaPulseIcon,
  'piercing-arrow': PiercingArrowIcon,
};

export const StatIconMap: Record<string, (props: IconProps) => JSX.Element> = {
  damage: DamageIcon,
  attackRate: AttackRateIcon,
  moveSpeed: MoveSpeedIcon,
  maxHealth: MaxHealthIcon,
  pickupRadius: PickupRadiusIcon,
};
