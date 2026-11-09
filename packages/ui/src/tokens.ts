/**
 * KLOCKR semantic design tokens (docs/DESIGN_SYSTEM.md §3).
 * Blue = product/information/selection. Green/amber/red = operational state only.
 * Keep in sync with tokens.css; the test asserts they match.
 */
export const colorTokens = {
  'bg-canvas': '#0B0B0D',
  'bg-chrome': '#101114',
  'bg-surface': '#141418',
  'bg-surface-raised': '#1A1D22',
  'bg-control': '#1F2126',
  'bg-control-hover': '#262A31',
  'border-subtle': '#2B2F36',
  'border-strong': '#3A4049',
  'text-primary': '#F5F7FA',
  'text-secondary': '#9AA0A6',
  'text-muted': '#6F7680',
  'accent-blue': '#3B82F6',
  'accent-blue-strong': '#1D9BF0',
  'accent-blue-dim': '#0C3151',
  'state-ok': '#22C55E',
  'state-warning': '#F59E0B',
  'state-critical': '#EF4444',
  'state-offline': '#9AA0A6',
} as const;

export type ColorToken = keyof typeof colorTokens;

/** CSS custom property reference for a token, e.g. `var(--k-text-primary)`. */
export const cssVar = (token: ColorToken): string => `var(--k-${token})`;
