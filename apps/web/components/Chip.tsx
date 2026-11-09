import { chipColor, type ChipSpec } from '@klockr/ui';

/** Status chip: text carries the meaning, color reinforces it (UI_COMPONENTS §2). */
export function Chip({ spec, testId }: { spec: ChipSpec; testId?: string }) {
  const color = chipColor[spec.variant];
  return (
    <span
      data-testid={testId}
      data-variant={spec.variant}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--k-spacing-2)',
        padding: '4px 10px',
        borderRadius: 'var(--k-radius-pill)',
        border: `1px solid ${color}`,
        color,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.1em',
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {spec.label}
    </span>
  );
}
