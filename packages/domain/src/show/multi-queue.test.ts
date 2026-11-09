import { describe, expect, it } from 'vitest';
import { areNotesVisibleTo, isItemVisibleTo, setItemVisibility } from '../audience';
import { presetDefaults, validateBoard, type Board } from '../board';
import { BoardId, QueueId, QueueItemId, ShowId } from '../ids';
import { createMessage, messagesFor, type Message } from '../message';
import { addItem, endItem, setCurrent, updateItem } from '../queue/operations';
import { nextItem } from '../queue/order';
import {
  acceptSuggestion,
  createRelation,
  deleteRelation,
  ignoreSuggestion,
  pendingSuggestions,
  reconcileSuggestions,
  updateRelation,
} from '../relation';
import type { Result } from '../result';
import { calculateShowSchedule } from '../schedule/show-engine';
import { setItemSchedule, transitionItemTimer } from '../schedule/operations';
import { MINUTE_MS, SECOND_MS } from '../time';
import { startTimer } from '../timer';
import {
  addQueue,
  deleteQueue,
  findQueue,
  moveQueue,
  queueView,
  setPrimaryQueue,
  withQueueView,
  type ShowAggregate,
} from './aggregate';
import { moveItemToQueue } from './move';
import { createQuickTimerShow } from './show';

function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`unexpected: ${JSON.stringify(r.error)}`);
  return r.value;
}

const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 10, h, m, s);
let n = 0;
const newId = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
const ctx = (now = at(9, 0)) => ({ now, newId });

function baseShow(): ShowAggregate {
  const qt = unwrap(
    createQuickTimerShow(
      {
        showId: ShowId('s'),
        queueId: QueueId('program'),
        queueItemId: QueueItemId('opening'),
        boardId: BoardId('speaker'),
      },
      10 * MINUTE_MS,
      0,
    ),
  );
  return {
    showId: qt.show.id,
    title: qt.show.title,
    revision: 0,
    primaryQueueId: qt.show.primaryQueueId,
    showWarning: qt.show.warning,
    showSchedule: { ...qt.show.schedule, timingMode: 'sliding' },
    queues: [{ queue: qt.queue, groups: [], items: [{ ...qt.item, title: 'Opening' }] }],
    locks: [],
    unlockRequests: [],
    relations: [],
    suggestions: [],
    boards: [qt.board],
    messages: [],
  };
}

/** Apply a single-Queue operation on a Show. */
function onQueue(
  show: ShowAggregate,
  queueId: string,
  op: Parameters<typeof withQueueView>[1] extends infer V ? (v: V) => V : never,
) {
  const view = queueView(show, queueId);
  if (!view) throw new Error('no queue');
  return withQueueView(show, op(view));
}

function add(show: ShowAggregate, queueId: string, title: string, min: number | null) {
  const view = queueView(show, queueId);
  if (!view) throw new Error('no queue');
  const out = unwrap(
    addItem(view, { title, durationMs: min === null ? null : min * MINUTE_MS }, ctx()),
  );
  return [withQueueView(show, out.aggregate), out.itemId] as const;
}

/** Program: Opening, Keynote, Q&A; Audio: Walk-in, Keynote mic, Q&A mics; Lighting likewise. */
function production() {
  let show = baseShow();
  const audio = unwrap(addQueue(show, { name: 'Audio', discipline: 'Audio' }, ctx()));
  show = audio.show;
  const light = unwrap(addQueue(show, { name: 'Lighting', discipline: 'Lighting' }, ctx()));
  show = light.show;
  const ids: Record<string, string> = { opening: 'opening' };
  for (const [q, title, key, min] of [
    ['program', 'Keynote', 'keynote', 20],
    ['program', 'Q&A', 'qa', 10],
    [audio.queueId, 'Walk-in', 'walkin', 10],
    [audio.queueId, 'Keynote mic', 'mic', 20],
    [audio.queueId, 'Q&A mics', 'qamics', 10],
    [light.queueId, 'Opening look', 'olook', 10],
    [light.queueId, 'Keynote look', 'klook', 20],
    [light.queueId, 'Q&A look', 'qalook', 10],
  ] as const) {
    const [next, id] = add(show, q, title, min);
    show = next;
    ids[key] = id;
  }
  const id = (k: string) => {
    const v = ids[k];
    if (!v) throw new Error(k);
    return v;
  };
  return { show, audio: audio.queueId as string, light: light.queueId as string, id };
}

describe('peer Queues and Primary', () => {
  it('Queues are peers with their own Current/Next; Primary is the Program Queue by default', () => {
    const { show, audio, light, id } = production();
    expect(show.queues.map((q) => q.queue.name)).toEqual(['Program', 'Audio', 'Lighting']);
    expect(show.primaryQueueId).toBe('program');
    let s = onQueue(show, audio, (v) =>
      unwrap(setCurrent(v, { id: QueueItemId(id('walkin')) }, ctx())),
    );
    s = onQueue(s, light, (v) => unwrap(setCurrent(v, { id: QueueItemId(id('olook')) }, ctx())));
    expect(findQueue(s, 'program')?.queue.currentItemId).toBe('opening');
    expect(findQueue(s, audio)?.queue.currentItemId).toBe(id('walkin'));
    expect(findQueue(s, light)?.queue.currentItemId).toBe(id('olook'));
    const audioView = queueView(s, audio);
    expect(audioView && nextItem(audioView)?.id).toBe(id('mic'));
  });

  it('timers in different Queues run simultaneously', () => {
    const { show, audio, id } = production();
    let s = onQueue(show, audio, (v) =>
      unwrap(setCurrent(v, { id: QueueItemId(id('mic')) }, ctx())),
    );
    for (const [q, item] of [
      ['program', 'opening'],
      [audio, id('mic')],
    ] as const) {
      const view = queueView(s, q);
      if (!view) throw new Error('view');
      s = withQueueView(
        s,
        unwrap(
          transitionItemTimer(
            view,
            { id: QueueItemId(item), transition: (t) => startTimer(t, at(9, 0)) },
            { now: at(9, 0) },
          ),
        ).aggregate,
      );
    }
    const running = s.queues.flatMap((q) => q.items).filter((i) => i.timer?.status === 'running');
    expect(running.map((i) => i.id)).toEqual(['opening', id('mic')]);
  });

  it('Primary can change but never disappears; unsafe Queue deletes are refused', () => {
    const { show, audio, id } = production();
    expect(deleteQueue(show, 'program', 0)).toMatchObject({ ok: false });
    const s = unwrap(setPrimaryQueue(show, audio));
    expect(s.primaryQueueId).toBe(audio);
    expect(unwrap(deleteQueue(s, 'program', 0)).queues.map((q) => q.queue.name)).toEqual([
      'Audio',
      'Lighting',
    ]);
    let live = onQueue(show, audio, (v) =>
      unwrap(setCurrent(v, { id: QueueItemId(id('mic')) }, ctx())),
    );
    const view = queueView(live, audio);
    if (!view) throw new Error('view');
    live = withQueueView(
      live,
      unwrap(
        transitionItemTimer(
          view,
          { id: QueueItemId(id('mic')), transition: (t) => startTimer(t, 0) },
          { now: 0 },
        ),
      ).aggregate,
    );
    expect(deleteQueue(live, audio, 0)).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
  });

  it('deleting a Queue removes its relations, suggestions and Board sources (no dangling data)', () => {
    const { show, audio, id } = production();
    let s = unwrap(
      createRelation(
        show,
        { sourceItemId: id('keynote'), targetItemId: id('mic'), offsetMs: 0, preserveOffset: true },
        ctx(),
      ),
    ).show;
    const board: Board = {
      ...(s.boards[0] as Board),
      sources: { kind: 'queues', queueIds: [QueueId(audio)] },
    };
    s = { ...s, boards: [board] };
    s = unwrap(deleteQueue(s, audio, 0));
    expect(s.relations).toHaveLength(0);
    expect(s.boards[0]?.sources).toEqual({ kind: 'primary' });
  });

  it('reorders Queues', () => {
    const { show, light } = production();
    expect(
      unwrap(moveQueue(show, { queueId: light, index: 0 })).queues.map((q) => q.queue.name),
    ).toEqual(['Lighting', 'Program', 'Audio']);
  });
});

describe('cross-Queue relations', () => {
  function planned() {
    const p = production();
    let s = onQueue(p.show, 'program', (v) =>
      unwrap(
        setItemSchedule(
          v,
          { id: QueueItemId('opening'), patch: { plannedStartAt: at(10, 0) } },
          ctx(),
        ),
      ),
    );
    s = onQueue(s, p.audio, (v) =>
      unwrap(
        setItemSchedule(
          v,
          { id: QueueItemId(p.id('walkin')), patch: { plannedStartAt: at(10, 0) } },
          ctx(),
        ),
      ),
    );
    s = unwrap(
      createRelation(
        s,
        {
          sourceItemId: p.id('keynote'),
          targetItemId: p.id('mic'),
          offsetMs: -30 * SECOND_MS,
          preserveOffset: true,
        },
        ctx(),
      ),
    ).show;
    return { ...p, show: s };
  }

  it('preserveOffset: target projected start = source projected start + offset; Planned untouched', () => {
    const { show, audio, id } = planned();
    // Opening started late: Keynote projected 10:05 -> mic linked 10:04:30.
    const view = queueView(show, 'program');
    if (!view) throw new Error('view');
    const s = withQueueView(
      show,
      unwrap(
        transitionItemTimer(
          view,
          { id: QueueItemId('opening'), transition: (t) => startTimer(t, at(10, 5)) },
          { now: at(10, 5) },
        ),
      ).aggregate,
    );
    const projection = calculateShowSchedule(s, at(10, 5));
    const keynote = projection.queues.get('program')?.items.find((i) => i.id === id('keynote'));
    const mic = projection.queues.get(audio)?.items.find((i) => i.id === id('mic'));
    expect(keynote?.projectedStart).toBe(at(10, 15));
    expect(mic).toMatchObject({
      projectedStart: at(10, 14, 30),
      plannedStart: at(10, 10),
      link: { desiredStart: at(10, 14, 30), conflict: false },
    });
    expect(projection.converged).toBe(true);
  });

  it('Strict keeps an explicit planned start: earlier link -> conflict, never earlier than planned', () => {
    const p = planned();
    let s = onQueue(p.show, p.audio, (v) =>
      unwrap(
        setItemSchedule(
          v,
          { id: QueueItemId(p.id('mic')), patch: { plannedStartAt: at(10, 20) } },
          ctx(),
        ),
      ),
    );
    s = { ...s, showSchedule: { ...s.showSchedule, timingMode: 'strict' } };
    const mic = calculateShowSchedule(s, at(9, 50))
      .queues.get(p.audio)
      ?.items.find((i) => i.id === p.id('mic'));
    expect(mic?.projectedStart).toBe(at(10, 20));
    expect(mic?.link).toMatchObject({ desiredStart: at(10, 9, 30), conflict: true });
    expect(calculateShowSchedule(s, at(9, 50)).relations[0]?.conflict).toBe(true);
  });

  it('Sliding follows the relation fully (also earlier than its own planned start)', () => {
    const p = planned();
    const s = onQueue(p.show, p.audio, (v) =>
      unwrap(
        setItemSchedule(
          v,
          { id: QueueItemId(p.id('mic')), patch: { plannedStartAt: at(10, 20) } },
          ctx(),
        ),
      ),
    );
    const mic = calculateShowSchedule(s, at(10, 0))
      .queues.get(p.audio)
      ?.items.find((i) => i.id === p.id('mic'));
    expect(mic?.projectedStart).toBe(at(10, 9, 30));
  });

  it('a fixed anchor keeps its planned time against a relation', () => {
    const p = planned();
    const s = onQueue(p.show, p.audio, (v) =>
      unwrap(
        setItemSchedule(
          v,
          {
            id: QueueItemId(p.id('mic')),
            patch: { plannedStartAt: at(10, 30), fixedAnchor: true },
          },
          ctx(),
        ),
      ),
    );
    const mic = calculateShowSchedule(s, at(9, 50))
      .queues.get(p.audio)
      ?.items.find((i) => i.id === p.id('mic'));
    expect(mic?.projectedStart).toBe(at(10, 30));
    expect(mic?.link?.conflict).toBe(true);
  });

  it('rejects same-Queue links, duplicate timing relations and cycles', () => {
    const { show, id } = planned();
    expect(
      createRelation(
        show,
        { sourceItemId: 'opening', targetItemId: id('keynote'), offsetMs: 0, preserveOffset: true },
        ctx(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      createRelation(
        show,
        { sourceItemId: id('qa'), targetItemId: id('mic'), offsetMs: 0, preserveOffset: true },
        ctx(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      JSON.stringify(
        createRelation(
          show,
          { sourceItemId: id('qa'), targetItemId: id('mic'), offsetMs: 0, preserveOffset: true },
          ctx(),
        ),
      ),
    ).toContain('one timing relation');
    // mic -> Keynote would close the loop Keynote -> mic.
    expect(
      createRelation(
        show,
        {
          sourceItemId: id('mic'),
          targetItemId: id('keynote'),
          offsetMs: 0,
          preserveOffset: false,
        },
        ctx(),
      ),
    ).toMatchObject({ ok: false });
    expect(
      JSON.stringify(
        createRelation(
          show,
          {
            sourceItemId: id('mic'),
            targetItemId: id('keynote'),
            offsetMs: 0,
            preserveOffset: false,
          },
          ctx(),
        ),
      ),
    ).toContain('cycle');
    // Through the queue order: Q&A mics comes after mic; Q&A mics -> Opening is a cycle via Keynote.
    expect(
      createRelation(
        show,
        { sourceItemId: id('qamics'), targetItemId: 'opening', offsetMs: 0, preserveOffset: false },
        ctx(),
      ),
    ).toMatchObject({ ok: false });
  });

  it('update and delete a relation', () => {
    const { show, id } = planned();
    const relationId = show.relations[0]?.id ?? '';
    const s = unwrap(updateRelation(show, { relationId, offsetMs: -MINUTE_MS }, ctx()));
    expect(s.relations[0]?.offsetMs).toBe(-MINUTE_MS);
    expect(unwrap(deleteRelation(s, relationId)).relations).toHaveLength(0);
    expect(id('mic')).toBeTruthy();
  });
});

describe('suggested follow (no auto-follow)', () => {
  function linked() {
    const p = production();
    let s = unwrap(
      createRelation(
        p.show,
        {
          sourceItemId: p.id('keynote'),
          targetItemId: p.id('mic'),
          offsetMs: 0,
          preserveOffset: true,
        },
        ctx(),
      ),
    ).show;
    s = unwrap(
      createRelation(
        s,
        {
          sourceItemId: p.id('keynote'),
          targetItemId: p.id('klook'),
          offsetMs: 0,
          preserveOffset: true,
        },
        ctx(),
      ),
    ).show;
    s = onQueue(s, p.audio, (v) =>
      unwrap(setCurrent(v, { id: QueueItemId(p.id('walkin')) }, ctx())),
    );
    s = onQueue(s, p.light, (v) =>
      unwrap(setCurrent(v, { id: QueueItemId(p.id('olook')) }, ctx())),
    );
    return { ...p, show: s };
  }
  function advanceProgram(show: ShowAggregate) {
    const next = onQueue(
      show,
      'program',
      (v) =>
        unwrap(endItem(v, { id: QueueItemId('opening'), advance: true }, ctx(at(10, 10))))
          .aggregate,
    );
    return reconcileSuggestions(show, next, { now: at(10, 10), newId });
  }

  it('Program END + NEXT suggests to Audio and Lighting without changing their Current', () => {
    const { show, audio, light, id } = linked();
    const s = advanceProgram(show);
    expect(findQueue(s, 'program')?.queue.currentItemId).toBe(id('keynote'));
    expect(findQueue(s, audio)?.queue.currentItemId).toBe(id('walkin'));
    expect(findQueue(s, light)?.queue.currentItemId).toBe(id('olook'));
    expect(pendingSuggestions(s).map((x) => [x.targetQueueId, x.targetItemId])).toEqual([
      [audio, id('mic')],
      [light, id('klook')],
    ]);
  });

  it('accept makes the target Current (no timer start); ignore keeps Current', () => {
    const { show, audio, light, id } = linked();
    let s = advanceProgram(show);
    const [audioSuggestion, lightSuggestion] = pendingSuggestions(s);
    const accepted = unwrap(acceptSuggestion(s, audioSuggestion?.id ?? '', ctx()));
    expect(accepted.accepted).toBe(true);
    s = accepted.show;
    expect(findQueue(s, audio)?.queue.currentItemId).toBe(id('mic'));
    expect(findQueue(s, audio)?.items.find((i) => i.id === id('mic'))?.timer?.status).toBe('idle');
    s = unwrap(ignoreSuggestion(s, lightSuggestion?.id ?? '', ctx()));
    expect(findQueue(s, light)?.queue.currentItemId).toBe(id('olook'));
    expect(s.suggestions.map((x) => x.status)).toEqual(['accepted', 'ignored']);
  });

  it('a suggestion goes stale when the target Queue moved on by itself, and is never executed', () => {
    const { show, audio, id } = linked();
    const s = advanceProgram(show);
    const moved = onQueue(s, audio, (v) =>
      unwrap(setCurrent(v, { id: QueueItemId(id('qamics')) }, ctx())),
    );
    const reconciled = reconcileSuggestions(s, moved, { now: at(10, 11), newId });
    expect(reconciled.suggestions.find((x) => x.targetQueueId === audio)?.status).toBe('stale');
    // Accepting a suggestion that has become invalid marks it stale instead of executing it.
    const stale = unwrap(acceptSuggestion(moved, pendingSuggestions(s)[0]?.id ?? '', ctx()));
    expect(stale.accepted).toBe(false);
    expect(findQueue(stale.show, audio)?.queue.currentItemId).toBe(id('qamics'));
  });
});

describe('audiences, notes and Boards', () => {
  it('visibility filters items; null means everyone (backward compatible)', () => {
    let s = baseShow();
    const item = s.queues[0]?.items[0];
    if (!item) throw new Error('item');
    expect(isItemVisibleTo(item, 'public')).toBe(true);
    s = onQueue(s, 'program', (v) =>
      unwrap(setItemVisibility(v, { id: 'opening', visibility: ['production'] }, ctx())),
    );
    const hidden = s.queues[0]?.items[0];
    if (!hidden) throw new Error('item');
    expect(isItemVisibleTo(hidden, 'production')).toBe(true);
    expect(isItemVisibleTo(hidden, 'stage')).toBe(false);
    expect(isItemVisibleTo(hidden, 'public')).toBe(false);
  });

  it('the notes property is never published unless explicitly allowed for that audience', () => {
    let s = onQueue(baseShow(), 'program', (v) =>
      unwrap(updateItem(v, { id: QueueItemId('opening'), patch: { notes: 'Headset 3' } }, ctx())),
    );
    const item = () =>
      s.queues[0]?.items[0] ??
      (() => {
        throw new Error('item');
      })();
    expect(areNotesVisibleTo(item(), 'stage')).toBe(false);
    expect(areNotesVisibleTo(item(), 'backstage')).toBe(false);
    s = onQueue(s, 'program', (v) =>
      unwrap(
        setItemVisibility(
          v,
          { id: 'opening', visibility: null, notesAudiences: ['backstage'] },
          ctx(),
        ),
      ),
    );
    expect(areNotesVisibleTo(item(), 'backstage')).toBe(true);
    expect(areNotesVisibleTo(item(), 'stage')).toBe(false);
  });

  it('presets are starting configurations of the same Board; validation keeps it constrained', () => {
    const speaker = presetDefaults('speaker_confidence');
    expect(speaker).toMatchObject({ audience: 'stage', sources: { kind: 'primary' } });
    expect(speaker.components.find((c) => c.kind === 'timer')).toMatchObject({
      enabled: true,
      size: 'large',
    });
    expect(speaker.components.find((c) => c.kind === 'notes')?.enabled).toBe(false);
    const production = presetDefaults('production');
    expect(production.audience).toBe('production');
    const base = { ...(baseShow().boards[0] as Board) };
    expect(
      validateBoard({ ...base, sources: { kind: 'queues', queueIds: [QueueId('nope')] } }, [
        QueueId('program'),
      ]).ok,
    ).toBe(false);
    expect(
      validateBoard(
        {
          ...base,
          components: [...base.components, base.components[0] as Board['components'][number]],
        },
        [QueueId('program')],
      ).ok,
    ).toBe(false);
    expect(validateBoard(base, [QueueId('program')]).ok).toBe(true);
  });

  it('messages target audiences and/or Boards and expire', () => {
    const message = (
      text: string,
      audiences: ('stage' | 'production')[],
      ttl: number | null,
      boardIds: string[] = [],
    ): Message =>
      unwrap(
        createMessage({
          id: newId(),
          text,
          audiences,
          boardIds: boardIds.map(BoardId),
          priority: 'urgent',
          ttlMs: ttl,
          now: at(10, 0),
        }),
      );
    const list = [
      message('WRAP UP', ['stage'], MINUTE_MS),
      message('CHECK MIC 3', ['production'], null),
      message('ONLY THIS', [], null, ['b2']),
    ];
    const stage = { id: BoardId('b1'), audience: 'stage' as const };
    expect(messagesFor(list, stage, at(10, 0, 30)).map((m) => m.text)).toEqual(['WRAP UP']);
    expect(messagesFor(list, stage, at(10, 1, 1))).toHaveLength(0);
    expect(
      messagesFor(list, { id: BoardId('b2'), audience: 'public' }, at(10, 0)).map((m) => m.text),
    ).toEqual(['ONLY THIS']);
    expect(
      createMessage({
        id: '1',
        text: ' ',
        audiences: ['stage'],
        boardIds: [],
        priority: 'normal',
        ttlMs: null,
        now: 0,
      }).ok,
    ).toBe(false);
  });
});

describe('cross-Queue item move', () => {
  it('moves a not-live item atomically; Current and running items are refused', () => {
    const { show, audio, id } = production();
    const s = unwrap(
      moveItemToQueue(show, { itemId: id('qa'), queueId: audio, groupId: null, index: 0 }, ctx()),
    );
    expect(findQueue(s, audio)?.items.find((i) => i.id === id('qa'))?.queueId).toBe(audio);
    expect(findQueue(s, 'program')?.items.some((i) => i.id === id('qa'))).toBe(false);
    expect(s.revision).toBe(show.revision + 1);
    expect(
      moveItemToQueue(show, { itemId: 'opening', queueId: audio, groupId: null, index: 0 }, ctx()),
    ).toMatchObject({ ok: false });
  });

  it('refuses a move that would put both ends of a relation into one Queue', () => {
    const { show, audio, id } = production();
    const s = unwrap(
      createRelation(
        show,
        {
          sourceItemId: id('keynote'),
          targetItemId: id('mic'),
          offsetMs: 0,
          preserveOffset: false,
        },
        ctx(),
      ),
    ).show;
    expect(
      moveItemToQueue(s, { itemId: id('keynote'), queueId: audio, groupId: null, index: 0 }, ctx()),
    ).toMatchObject({ ok: false });
  });
});
