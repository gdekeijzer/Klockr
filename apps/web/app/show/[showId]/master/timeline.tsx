'use client';

import type { ShowStateSnapshot } from '@klockr/contracts';
import { showEffectiveLock, type ShowAggregate, type ShowScheduleProjection } from '@klockr/domain';
import { formatClock, formatOffset } from '@klockr/ui';
import { useState } from 'react';
import { LockIcon } from '../../../../components/LockIcon';
import styles from '../show.module.css';
import tl from './timeline.module.css';

const PX_PER_MINUTE = 6;
const MIN = 60_000;

/**
 * Multi-Queue timeline: one lane per peer Queue on a shared time axis. Planned blocks are drawn
 * as outlines, projected blocks as filled blocks; Current, fixed anchors, relation markers,
 * conflicts and locks are labelled (never colour-only). The visible window is fixed at first
 * render (no auto-centering, no scroll jumps); live shifts only move blocks within it and are
 * marked SHIFT. No animation (reduced motion friendly).
 */
export function Timeline(props: {
  state: ShowStateSnapshot;
  show: ShowAggregate;
  projection: ShowScheduleProjection;
  now: number;
  selectedItem: string | null;
  onSelect: (itemId: string) => void;
}) {
  const { state, projection, now } = props;
  const tz = state.queues[0]?.showSchedule.timeZone ?? 'UTC';
  const tolerance = state.queues[0]?.showSchedule.toleranceMs ?? 30_000;
  const starts = [...projection.queues.values()]
    .flatMap((p) => p.items.flatMap((i) => [i.plannedStart, i.projectedStart]))
    .filter((t): t is number => t !== null);
  const ends = [...projection.queues.values()]
    .flatMap((p) => p.items.flatMap((i) => [i.plannedEnd, i.projectedEnd]))
    .filter((t): t is number => t !== null);
  // The window is chosen once per mount (stable axis while the operator works).
  const [origin] = useState(
    () => Math.floor(Math.min(now, ...starts) / (15 * MIN)) * 15 * MIN - 15 * MIN,
  );
  const end = Math.max(now + 60 * MIN, ...ends) + 15 * MIN;
  const width = ((end - origin) / MIN) * PX_PER_MINUTE;
  const x = (t: number) => ((t - origin) / MIN) * PX_PER_MINUTE;
  const ticks: number[] = [];
  for (let t = origin; t <= end; t += 15 * MIN) ticks.push(t);
  const relationsByTarget = new Map(state.relations.map((r) => [r.targetItemId, r]));
  const relationsBySource = new Set(state.relations.map((r) => r.sourceItemId));
  const conflicts = new Set(
    projection.relations.filter((r) => r.conflict).map((r) => r.relationId),
  );

  return (
    <div className={tl.wrap} data-testid="timeline">
      <div className={tl.lanes}>
        <div className={tl.laneLabels}>
          <div className={tl.axisLabel} />
          {state.queues.map((q) => (
            <div key={q.id} className={tl.laneLabel} data-testid="timeline-lane-label">
              {q.isPrimary && <span title="Primary">★ </span>}
              {q.name}
              {showEffectiveLock(props.show, { kind: 'queue', id: q.id }) && (
                <span className={tl.lock}>
                  <LockIcon />
                </span>
              )}
            </div>
          ))}
        </div>
        <div className={tl.scroll}>
          <div className={tl.canvas} style={{ width }}>
            <div className={tl.axis}>
              {ticks.map((t) => (
                <span key={t} className={tl.tick} style={{ left: x(t) }}>
                  {formatClock(t, tz)}
                </span>
              ))}
            </div>
            {state.queues.map((q) => {
              const p = projection.queues.get(q.id);
              return (
                <div key={q.id} className={tl.lane} data-testid="timeline-lane" data-queue={q.name}>
                  {q.items.map((item) => {
                    const s = p?.items.find((i) => i.id === item.id);
                    if (!s || s.skipped) return null;
                    const relation = relationsByTarget.get(item.id);
                    const conflict = relation ? conflicts.has(relation.id) : false;
                    const shift = s.startShiftMs ?? 0;
                    const start = s.projectedStart ?? s.plannedStart;
                    const stop = s.projectedEnd ?? s.plannedEnd;
                    return (
                      <div key={item.id}>
                        {s.plannedStart !== null && s.plannedEnd !== null && (
                          <div
                            className={tl.planned}
                            style={{
                              left: x(s.plannedStart),
                              width: Math.max(4, x(s.plannedEnd) - x(s.plannedStart)),
                            }}
                            aria-hidden
                          />
                        )}
                        {start !== null && stop !== null && (
                          <button
                            type="button"
                            className={tl.block}
                            style={{ left: x(start), width: Math.max(18, x(stop) - x(start)) }}
                            data-current={item.lifecycle === 'current'}
                            data-completed={item.lifecycle === 'completed'}
                            data-selected={props.selectedItem === item.id}
                            data-conflict={conflict}
                            data-testid="timeline-block"
                            data-title={item.title}
                            title={`${item.title} · planned ${formatClock(s.plannedStart, tz)} · projected ${formatClock(s.projectedStart, tz)}`}
                            onClick={() => {
                              props.onSelect(item.id);
                            }}
                          >
                            <span className={tl.blockTitle}>{item.title}</span>
                            <span className={tl.blockMeta}>
                              {item.lifecycle === 'current' && 'CURRENT '}
                              {item.fixedAnchor && 'FIXED '}
                              {(relation || relationsBySource.has(item.id)) && '⛓ '}
                              {conflict && 'CONFLICT '}
                              {Math.abs(shift) > tolerance &&
                                item.lifecycle !== 'completed' &&
                                `SHIFT ${formatOffset(shift)}`}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div
              className={tl.now}
              style={{ left: x(now) }}
              aria-label="now"
              data-testid="timeline-now"
            />
          </div>
        </div>
      </div>
      <p className={styles.muted}>
        Outline = planned · filled = projected · ⛓ = related across Queues · FIXED = fixed anchor ·
        the axis stays put while the show runs.
      </p>
    </div>
  );
}
