import { useRef, type TouchEvent } from 'react';

/** How far a finger has to travel sideways, in pixels, for a swipe. */
const MIN_DISTANCE = 56;
/** A slower drag is not a swipe. */
const MAX_MS = 700;
/** A swipe is mostly sideways: a mostly vertical drag is the page scrolling. */
const SIDEWAYS_BIAS = 1.5;
/** How far a finger has to move before the gesture is judged sideways or not. */
const INTENT_DISTANCE = 10;

interface DragOptions {
  /** Called while a finger moves sideways, with how far it has gone from where it started. */
  onDrag?: (dx: number) => void;
  /** Called when the finger lifts or the gesture is cancelled, after any swipe has been reported. */
  onRelease?: () => void;
}

/** Touch handlers that report a quick sideways swipe. The direction is the way the finger moved. */
export function useSwipe(onSwipe: (direction: 'left' | 'right') => void, { onDrag, onRelease }: DragOptions = {}) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  /** Whether this gesture has been read as sideways (true), as scrolling (false), or not yet (null). */
  const sideways = useRef<boolean | null>(null);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const touch = event.touches[0];
      // A second finger (a pinch, say) cancels the gesture.
      start.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
      sideways.current = null;
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const from = start.current;
      const touch = event.touches[0];
      if (!from || !touch || !onDrag) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (sideways.current === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < INTENT_DISTANCE) return;
        sideways.current = Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_BIAS;
      }
      if (sideways.current) onDrag(dx);
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      sideways.current = null;
      const touch = event.changedTouches[0];
      try {
        if (from && touch) {
          const dx = touch.clientX - from.x;
          const dy = touch.clientY - from.y;
          const quick = Date.now() - from.at <= MAX_MS;
          const far = Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) >= Math.abs(dy) * SIDEWAYS_BIAS;
          if (quick && far) onSwipe(dx < 0 ? 'left' : 'right');
        }
      } finally {
        onRelease?.();
      }
    },
    onTouchCancel() {
      start.current = null;
      sideways.current = null;
      onRelease?.();
    },
  };
}
