import type { Audience } from '../audience';
import type { BoardId, EventId, QueueId, RoomId, ShowId } from '../ids';
import { err, ok, type Result } from '../result';
import type { EpochMs } from '../time';

/**
 * Board = presentation configuration over authoritative Show / Queue state (ADR-0002). It never
 * holds timer state. Configuration is constrained: supported presets/layouts, an ordered list of
 * known components with a few typed settings — no free canvas, no pixel coordinates.
 */
export const BOARD_PRESETS = [
  'speaker_confidence',
  'stage_manager',
  'production',
  'backstage',
  'room_agenda',
  'public_agenda',
  'custom',
] as const;
export type BoardPreset = (typeof BOARD_PRESETS)[number];

export const BOARD_COMPONENTS = [
  'message',
  'current_title',
  'subtitle',
  'timer',
  'progress',
  'next_item',
  'wall_clock',
  'show_offset',
  'queue_current_next',
  'running_timers',
  'agenda',
  'anchor',
  'notes',
] as const;
export type BoardComponentKind = (typeof BOARD_COMPONENTS)[number];

export type ComponentSize = 'small' | 'medium' | 'large';

export interface BoardComponent {
  readonly kind: BoardComponentKind;
  readonly enabled: boolean;
  readonly size: ComponentSize;
  /** Number of upcoming items (agenda / next lists). */
  readonly upcoming: number;
}

/**
 * Data sources (source mode):
 * - `primary`: follow the Show's Primary Queue (also after the Primary changes);
 * - `all`: every Queue of the Show in Show order, including Queues added later (dynamic);
 * - `selected`: an explicit ordered selection; only that selection is followed.
 */
export type BoardSources =
  | { readonly kind: 'primary' }
  | { readonly kind: 'all' }
  | { readonly kind: 'selected'; readonly queueIds: readonly QueueId[] }
  /** Event Boards only (M5): every Show of one Room (Room Agenda). */
  | { readonly kind: 'room'; readonly roomId: RoomId }
  /** Event Boards only (M5): per Room its current Show, plus Event Shows without Room. */
  | { readonly kind: 'event' };

/** Source modes a Show-owned Board may use; `room`/`event` need an Event-owned Board. */
export const SHOW_SOURCE_KINDS = ['primary', 'all', 'selected'] as const;
export const EVENT_SOURCE_KINDS = ['room', 'event'] as const;

export interface BoardPresentation {
  /** Dimmed palette for dark stages. */
  readonly lowLight: boolean;
  /** Show planned/projected times in agenda lists. */
  readonly showTimes: boolean;
}

export interface Board {
  readonly id: BoardId;
  /**
   * Owner: a Show (Show Boards, M1-M4) XOR an Event (Event/Room Boards, M5). The same Board
   * object and renderer; only the available source modes differ.
   */
  readonly showId: ShowId | null;
  readonly eventId: EventId | null;
  readonly name: string;
  readonly preset: BoardPreset;
  readonly audience: Audience;
  readonly sources: BoardSources;
  /** Ordered: the order is the presentation order inside the preset's layout. */
  readonly components: readonly BoardComponent[];
  readonly presentation: BoardPresentation;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  readonly revision: number;
}

const c = (
  kind: BoardComponentKind,
  enabled = true,
  size: ComponentSize = 'medium',
  upcoming = 3,
): BoardComponent => ({ kind, enabled, size, upcoming });

/** Every component appears exactly once; disabled ones keep their configured position. */
function complete(list: BoardComponent[]): BoardComponent[] {
  const present = new Set(list.map((x) => x.kind));
  return [...list, ...BOARD_COMPONENTS.filter((k) => !present.has(k)).map((k) => c(k, false))];
}

/** A preset is only a starting configuration of the same Board object. */
export function presetDefaults(preset: BoardPreset): {
  name: string;
  audience: Audience;
  sources: BoardSources;
  components: BoardComponent[];
  presentation: BoardPresentation;
} {
  const primary = { kind: 'primary' } as const;
  const presentation = { lowLight: false, showTimes: true };
  switch (preset) {
    case 'speaker_confidence':
      return {
        name: 'Speaker Confidence',
        audience: 'stage',
        sources: primary,
        presentation: { lowLight: false, showTimes: false },
        components: complete([
          c('message', true, 'large'),
          c('current_title', true, 'medium'),
          c('subtitle', true, 'small'),
          c('timer', true, 'large'),
          c('progress', true, 'medium'),
          c('next_item', false, 'small'),
          c('wall_clock', false, 'small'),
        ]),
      };
    case 'stage_manager':
      return {
        name: 'Stage Manager',
        audience: 'backstage',
        sources: primary,
        presentation,
        components: complete([
          c('message', true, 'large'),
          c('current_title'),
          c('timer', true, 'large'),
          c('next_item', true, 'medium', 3),
          c('show_offset'),
          c('anchor'),
          c('running_timers'),
          c('wall_clock'),
          c('notes', false),
        ]),
      };
    case 'production':
      return {
        name: 'FOH / Production',
        audience: 'production',
        sources: { kind: 'all' },
        presentation,
        components: complete([
          c('message'),
          c('show_offset'),
          c('anchor'),
          c('queue_current_next', true, 'medium', 1),
          c('running_timers'),
          c('wall_clock'),
        ]),
      };
    case 'backstage':
      return {
        name: 'Backstage',
        audience: 'backstage',
        sources: primary,
        presentation,
        components: complete([
          c('message'),
          c('queue_current_next', true, 'medium', 2),
          c('wall_clock'),
        ]),
      };
    case 'room_agenda':
      return {
        name: 'Room Agenda',
        audience: 'public',
        sources: primary,
        presentation,
        components: complete([c('message'), c('agenda', true, 'medium', 6), c('wall_clock')]),
      };
    case 'public_agenda':
      return {
        name: 'Public Agenda',
        audience: 'public',
        sources: primary,
        presentation,
        components: complete([
          c('message'),
          c('current_title', true, 'large'),
          c('agenda', true, 'medium', 5),
          c('wall_clock', true, 'small'),
        ]),
      };
    case 'custom':
      return {
        name: 'Custom Board',
        audience: 'stage',
        sources: primary,
        presentation,
        components: complete([c('message'), c('current_title'), c('timer'), c('next_item')]),
      };
  }
}

export interface BoardPatch {
  readonly name?: string | undefined;
  readonly audience?: Audience | undefined;
  readonly sources?: BoardSources | undefined;
  readonly components?: readonly BoardComponent[] | undefined;
  readonly presentation?: Partial<BoardPresentation> | undefined;
}

/** Validate a configuration: known components exactly once, sane limits, existing Queues. */
export function validateBoard(
  board: Board,
  queueIds: readonly QueueId[],
  roomIds: readonly string[] = [],
): Result<Board, string> {
  const name = board.name.trim();
  if ((board.showId === null) === (board.eventId === null)) {
    return err('a Board belongs to exactly one Show or one Event');
  }
  const allowed: readonly string[] = board.showId !== null ? SHOW_SOURCE_KINDS : EVENT_SOURCE_KINDS;
  if (!allowed.includes(board.sources.kind)) {
    return err(
      board.showId !== null
        ? 'a Show Board reads its own Queues (primary, all or selected)'
        : 'an Event Board reads a Room or the whole Event',
    );
  }
  if (board.sources.kind === 'room' && !roomIds.includes(board.sources.roomId)) {
    return err('unknown source room');
  }
  if (name.length === 0 || name.length > 100) return err('board name must be 1-100 characters');
  const kinds = board.components.map((x) => x.kind);
  if (new Set(kinds).size !== kinds.length) return err('each component may appear only once');
  if (kinds.some((k) => !(BOARD_COMPONENTS as readonly string[]).includes(k))) {
    return err('unknown component');
  }
  if (
    board.components.some((x) => !Number.isInteger(x.upcoming) || x.upcoming < 0 || x.upcoming > 20)
  ) {
    return err('upcoming must be between 0 and 20');
  }
  if (board.sources.kind === 'selected') {
    const ids = board.sources.queueIds;
    if (ids.length === 0) return err('select at least one source queue');
    if (ids.some((id) => !queueIds.includes(id))) return err('unknown source queue');
    if (new Set(ids).size !== ids.length) return err('duplicate source queue');
  }
  return ok({ ...board, name, components: complete([...board.components]) });
}

/** Queues a Board reads, in order (Primary and `all` resolved against the current Show). */
export function boardSourceQueues(
  board: Board,
  primaryQueueId: QueueId,
  allQueueIds: readonly QueueId[],
): QueueId[] {
  switch (board.sources.kind) {
    case 'primary':
      return [primaryQueueId];
    case 'all':
      return [...allQueueIds];
    case 'selected':
      return [...board.sources.queueIds];
    case 'room':
    case 'event':
      // Event-level sources are resolved over Shows, not over Queues of one Show.
      return [];
  }
}
