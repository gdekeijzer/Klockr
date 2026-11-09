'use client';

import { useEffect, useState } from 'react';

/**
 * Current time on the server clock, refreshed for rendering only (~10x per second). This is a
 * projection tick for the display; it never changes authoritative state.
 */
export function useServerNow(offsetMs: number, intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= intervalMs) {
        last = t;
        setNow(Date.now() + offsetMs);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    // rAF pauses in background tabs; keep a slow interval as a fallback.
    const fallback = setInterval(() => {
      setNow(Date.now() + offsetMs);
    }, 1_000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(fallback);
    };
  }, [offsetMs, intervalMs]);
  return now;
}
