import { useRef, type TouchEvent } from 'react';

/** How far a finger has to travel sideways, in pixels, for a swipe. */
const MIN_DISTANCE = 56;
/** A slower drag is not a swipe. */
const MAX_MS = 700;
/** A swipe is mostly sideways: a mostly vertical drag is the page scrolling. */
const SIDEWAYS_BIAS = 1.5;

/** Touch handlers that report a quick sideways swipe. The direction is the way the finger moved. */
export function useSwipe(onSwipe: (direction: 'left' | 'right') => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const touch = event.touches[0];
      // A second finger (a pinch, say) cancels the gesture.
      start.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Date.now() - from.at > MAX_MS) return;
      if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * SIDEWAYS_BIAS) return;
      onSwipe(dx < 0 ? 'left' : 'right');
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}
