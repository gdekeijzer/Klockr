import source from '../../../docs/design/tokens.json';

/**
 * Design tokens. `docs/design/tokens.json` is the single source of truth; this module only
 * flattens it into CSS custom properties. Never copy token values into code.
 *
 * Naming: `color.background.canvas` -> `--k-background-canvas`, `spacing.4` -> `--k-spacing-4`,
 * `radius.control` -> `--k-radius-control`, `typography.uiFamily` -> `--k-typography-ui-family`.
 */
interface TokenLeaf {
  readonly $value: string;
}

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function isLeaf(value: unknown): value is TokenLeaf {
  return typeof value === 'object' && value !== null && '$value' in value;
}

function flatten(node: unknown, path: readonly string[], out: Map<string, string>): void {
  if (isLeaf(node)) {
    const [group, ...rest] = path;
    const parts = group === 'color' ? rest : path;
    out.set(`--k-${parts.map(kebab).join('-')}`, node.$value);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'meta' || key.startsWith('$')) continue;
    flatten(child, [...path, key], out);
  }
}

const flat = new Map<string, string>();
flatten(source, [], flat);

/** All tokens as CSS custom property name -> value. */
export const tokenVariables: ReadonlyMap<string, string> = flat;

/** `:root { ... }` block for injection into the document. Content comes from the repo only. */
export function tokensCss(): string {
  const body = [...flat].map(([name, value]) => `  ${name}: ${value};`).join('\n');
  return `:root {\n${body}\n  color-scheme: dark;\n}\n`;
}

export type SemanticColor =
  | 'background-canvas'
  | 'background-chrome'
  | 'background-surface'
  | 'background-surface-raised'
  | 'background-control'
  | 'background-control-hover'
  | 'border-subtle'
  | 'border-strong'
  | 'text-primary'
  | 'text-secondary'
  | 'text-muted'
  | 'accent-blue'
  | 'accent-blue-strong'
  | 'accent-blue-dim'
  | 'state-ok'
  | 'state-warning'
  | 'state-critical'
  | 'state-offline';

/** `var(--k-…)` reference for a semantic color token. */
export const colorVar = (token: SemanticColor): string => `var(--k-${token})`;
