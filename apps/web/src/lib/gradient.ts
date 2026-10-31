import type { CSSProperties } from 'react';

const PALETTES: Array<[string, string]> = [
  ['#ff6b4a', '#7c3aed'],
  ['#22d3ee', '#2563eb'],
  ['#fbbf24', '#f43f5e'],
  ['#34d399', '#0ea5e9'],
  ['#f472b6', '#8b5cf6'],
  ['#fb7185', '#f59e0b'],
  ['#a3e635', '#14b8a6'],
  ['#60a5fa', '#a78bfa'],
];

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function coverGradient(seed: string): CSSProperties {
  const palette = PALETTES[hashString(seed) % PALETTES.length];
  return {
    '--cover-a': palette[0],
    '--cover-b': palette[1],
  } as CSSProperties;
}

export function coverGradientColors(seed: string): { from: string; to: string } {
  const palette = PALETTES[hashString(seed) % PALETTES.length];
  return { from: palette[0], to: palette[1] };
}
