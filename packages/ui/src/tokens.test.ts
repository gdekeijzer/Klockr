import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorVar, tokensCss, tokenVariables } from './tokens';

describe('design tokens from docs/design/tokens.json', () => {
  const json = readFileSync(new URL('../../../docs/design/tokens.json', import.meta.url), 'utf8');

  it('exposes every token value from tokens.json and nothing hand-copied', () => {
    const values = [...json.matchAll(/"\$value":\s*"([^"]+)"/g)].map((m) => m[1]);
    expect([...tokenVariables.values()].sort()).toEqual([...values].sort());
  });

  it('maps semantic names used by the UI', () => {
    expect(tokenVariables.get('--k-background-canvas')).toBe('#0B0B0D');
    expect(tokenVariables.get('--k-text-primary')).toBe('#F5F7FA');
    expect(tokenVariables.get('--k-state-ok')).toBe('#22C55E');
    expect(tokenVariables.get('--k-radius-control')).toBe('6px');
    expect(tokensCss()).toContain('--k-state-critical: #EF4444;');
    expect(colorVar('state-warning')).toBe('var(--k-state-warning)');
  });

  it('every semantic color referenced by colorVar exists', () => {
    for (const name of [
      'background-canvas',
      'background-surface',
      'text-secondary',
      'accent-blue',
      'state-warning',
      'state-critical',
      'state-offline',
    ]) {
      expect(tokenVariables.has(`--k-${name}`)).toBe(true);
    }
  });
});
