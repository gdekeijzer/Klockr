import type { TimerPhase, TimerStatus } from '@klockr/domain';
import { colorVar } from './tokens';

/**
 * Color communicates state, never decoration (DESIGN_SYSTEM §3.4, §10, §11).
 * Normal timer digits are white/light gray on every surface; running is signalled separately.
 */
export function timerDigitColor(phase: TimerPhase): string {
  switch (phase) {
    case 'normal':
      return colorVar('text-primary');
    case 'warning':
      return colorVar('state-warning');
    case 'critical':
    case 'overtime':
      return colorVar('state-critical');
  }
}

export type ChipVariant = 'neutral' | 'info' | 'success' | 'warning' | 'critical' | 'offline';

export interface ChipSpec {
  readonly label: string;
  readonly variant: ChipVariant;
}

/** Status chip for the timer state: text carries meaning, color reinforces it. */
export function timerStatusChip(status: TimerStatus): ChipSpec {
  switch (status) {
    case 'idle':
      return { label: 'READY', variant: 'neutral' };
    case 'running':
      return { label: 'RUNNING', variant: 'success' };
    case 'paused':
      return { label: 'PAUSED', variant: 'neutral' };
    case 'stopped':
      return { label: 'STOPPED', variant: 'neutral' };
  }
}

export function timerPhaseChip(phase: TimerPhase): ChipSpec | null {
  switch (phase) {
    case 'normal':
      return null;
    case 'warning':
      return { label: 'WARNING', variant: 'warning' };
    case 'critical':
      return { label: 'CRITICAL', variant: 'critical' };
    case 'overtime':
      return { label: 'OVERTIME', variant: 'critical' };
  }
}

export const chipColor: Readonly<Record<ChipVariant, string>> = {
  neutral: colorVar('text-secondary'),
  info: colorVar('accent-blue'),
  success: colorVar('state-ok'),
  warning: colorVar('state-warning'),
  critical: colorVar('state-critical'),
  offline: colorVar('state-offline'),
};
