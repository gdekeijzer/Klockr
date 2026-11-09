import type { GroupId, QueueId, QueueItemId, ShowId } from '../ids';
import type { EpochMs } from '../time';
import type { TimerState, TimerThresholds } from '../timer';

/**
 * Queue model (docs/DOMAIN_MODEL.md, QUEUES_SCHEDULING.md).
 *
 * The structure is deliberately flat: Queue -> (optional) Group -> Queue Item. A Group is a real
 * container of Queue Items but never contains another Group. There is no Session/Cue/Timer
 * hierarchy: a timer is an optional capability of a Queue Item, and "Speaker", "Note", "Break"
 * or "Timer" are only UI presets that pre-fill the same universal Queue Item.
 */

/** Peer lane of Queue Items. M2 uses exactly one per Show: the Program Queue. */
export interface Queue {
  readonly id: QueueId;
  readonly showId: ShowId;
  readonly name: string;
  readonly purpose: 'program';
  readonly position: number;
  /**
   * The single operational `current` position of this Queue (null before anything is current or
   * after the last item ended). `next` is NOT stored: it is derived with {@link nextItem}.
   */
  readonly currentItemId: QueueItemId | null;
  /** Queue-level override of the Show's warning thresholds; null inherits the Show default. */
  readonly warning: TimerThresholds | null;
  /**
   * Optimistic-concurrency revision of the Queue as a whole (structure, current position and
   * item lifecycle). Increments by one on every accepted Queue command. Timer transitions have
   * their own per-timer revision and do not bump it.
   */
  readonly revision: number;
}

/** Real container within a Queue. One level only. */
export interface Group {
  readonly id: GroupId;
  readonly queueId: QueueId;
  readonly title: string;
  /** Position among the Queue's top-level entries (items without group and groups). */
  readonly position: number;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
}

/**
 * How an item's timer starts. `manual` (default): only an explicit START. `on_previous_end`
 * ("On previous END", FUNCTIONAL_DESIGN §18): END + NEXT that makes this item current also
 * starts its timer. Nothing else ever starts a timer implicitly.
 */
export type StartMode = 'manual' | 'on_previous_end';

/** Universal Queue Item. Every property beyond identity/title/order is optional. */
export interface QueueItem {
  readonly id: QueueItemId;
  readonly queueId: QueueId;
  /** Containing Group, or null for a top-level item. */
  readonly groupId: GroupId | null;
  readonly title: string;
  readonly subtitle: string | null;
  /** Operator-facing notes. Never rendered on Speaker/Public Boards. */
  readonly notes: string | null;
  /** Free classification only (FUNCTIONAL_DESIGN §13); never carries behaviour. */
  readonly tags: readonly string[];
  /** Position within its container (the Group, or the Queue's top level). */
  readonly position: number;
  /** Inactive items stay in the Queue but are skipped by NEXT. */
  readonly active: boolean;
  /** Set by END; cleared when the item becomes current again. */
  readonly completedAt: EpochMs | null;
  readonly startMode: StartMode;
  /** Item-level override of the inherited warning thresholds; null inherits. */
  readonly warning: TimerThresholds | null;
  /** Optional timer capability. An item without timer (e.g. a note) is fully valid. */
  readonly timer: TimerState | null;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  /** Increments whenever this item's own data (incl. position/lifecycle) changes. */
  readonly revision: number;
}

/**
 * Consistency boundary for Queue commands: the Queue with its Groups and Items, plus the Show's
 * warning default it inherits from. Persisted atomically (compare-and-set on `queue.revision`).
 */
export interface QueueAggregate {
  readonly showId: ShowId;
  /** Show-level default warning thresholds (top of the inheritance chain). */
  readonly showWarning: TimerThresholds;
  readonly queue: Queue;
  readonly groups: readonly Group[];
  readonly items: readonly QueueItem[];
}

/**
 * Derived operational lifecycle of an item. Precedence: current > completed > inactive >
 * upcoming. Only `currentItemId`, `completedAt` and `active` are stored.
 */
export type ItemLifecycle = 'current' | 'completed' | 'inactive' | 'upcoming';

export const QUEUE_LIMITS = {
  items: 500,
  groups: 100,
  title: 200,
  subtitle: 200,
  notes: 4_000,
  tags: 20,
  tag: 40,
} as const;
