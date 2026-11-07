import { useRef, type TouchEvent } from 'react';

/** How far a finger has to travel up or down, in pixels, for a swipe. */
const MIN_DISTANCE = 40;
/** A slower drag is not a swipe. */
const MAX_MS = 700;
/** A swipe is mostly vertical: a mostly sideways drag is something else. */
const VERTICAL_BIAS = 1.2;

/** Touch handlers that report a quick up or down swipe. The direction is the way the finger moved. */
export function useSheetSwipe(onSwipe: (direction: 'up' | 'down') => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const touch = event.touches[0];
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
      if (Math.abs(dy) < MIN_DISTANCE || Math.abs(dy) < Math.abs(dx) * VERTICAL_BIAS) return;
      onSwipe(dy < 0 ? 'up' : 'down');
    },
    onTouchCancel() {
      start.current = null;
    },
  };
}
