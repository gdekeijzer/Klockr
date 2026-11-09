import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorTokens } from './tokens';

describe('design tokens', () => {
  it('tokens.css defines every token with the same value', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries(colorTokens)) {
      expect(css).toContain(`--k-${name}: ${value.toLowerCase()};`);
    }
  });
});
