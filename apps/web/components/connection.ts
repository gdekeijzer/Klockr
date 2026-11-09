import type { ChipSpec } from '@klockr/ui';
import type { ConnectionStatus } from '../lib/use-realtime';

export function connectionChip(status: ConnectionStatus): ChipSpec {
  switch (status) {
    case 'connected':
      return { label: 'LIVE', variant: 'success' };
    case 'connecting':
      return { label: 'CONNECTING', variant: 'info' };
    case 'reconnecting':
      return { label: 'RECONNECTING', variant: 'warning' };
    case 'offline':
      return { label: 'OFFLINE', variant: 'offline' };
  }
}
