/** Remaining-time progress. Neutral/blue by default; never the only warning signal. */
export function ProgressBar({ fraction, color }: { fraction: number | null; color: string }) {
  if (fraction === null) return null;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      style={{
        height: 8,
        borderRadius: 'var(--k-radius-pill)',
        background: 'var(--k-background-control)',
        overflow: 'hidden',
      }}
    >
      <div style={{ width: `${String(fraction * 100)}%`, height: '100%', background: color }} />
    </div>
  );
}
