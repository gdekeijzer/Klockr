import type { EpochMs } from '../time';

/**
 * Locks (FUNCTIONAL_DESIGN §25). In M3 a lock is a STRUCTURE / CONFIGURATION lock: it blocks
 * structure, planning and timing-configuration edits on its target and everything below it.
 * It never blocks live transport (START/PAUSE/RESUME/STOP, END/NEXT, set current).
 */
export type LockTargetKind = 'show' | 'queue' | 'group' | 'item';

export interface LockTarget {
  readonly kind: LockTargetKind;
  readonly id: string;
}

/** Who did something (grant/credential record id, never a secret). */
export interface ActorRef {
  readonly kind: string;
  readonly id: string;
}

export interface Lock {
  readonly id: string;
  readonly target: LockTarget;
  readonly lockedAt: EpochMs;
  readonly lockedBy: ActorRef;
}

export interface UnlockRequest {
  readonly id: string;
  readonly lockId: string;
  readonly target: LockTarget;
  readonly requestedAt: EpochMs;
  readonly requestedBy: ActorRef;
  readonly reason: string | null;
}

export const sameTarget = (a: LockTarget, b: LockTarget): boolean =>
  a.kind === b.kind && a.id === b.id;
