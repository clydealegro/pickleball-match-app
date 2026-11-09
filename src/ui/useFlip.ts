import { gsap } from 'gsap';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionOK, MOTION } from './motion';

/**
 * Keeps the position of every `[data-flip]` item inside `ref`. When `signature` changes and an item has moved, it
 * travels from where it was to where it is now, so a reorder can be followed by eye. Hidden items are left alone.
 */
export function useFlip(ref: RefObject<HTMLElement>, signature: string) {
  const before = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-flip]'));
    for (const el of items) {
      const r = el.getBoundingClientRect();
      // Position inside the list, so scrolling it or the page is not read as a move.
      if (r.width > 0) next.set(el.dataset.flip!, { x: r.left - box.left + root.scrollLeft, y: r.top - box.top + root.scrollTop });
    }
    if (motionOK()) {
      for (const el of items) {
        const from = before.current.get(el.dataset.flip!);
        const to = next.get(el.dataset.flip!);
        if (!from || !to) continue;
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        gsap.killTweensOf(el);
        gsap.fromTo(el, { x: dx, y: dy }, { x: 0, y: 0, duration: MOTION.slow + 0.1, ease: MOTION.out, clearProps: 'transform' });
      }
    }
    before.current = next;
  }, [ref, signature]);
}
