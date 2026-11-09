import { gsap } from 'gsap';
import { useEffect, useId, useRef, type ReactNode, type TouchEvent } from 'react';
import { motionOK, MOTION } from './motion';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A modal panel: a bottom sheet on phones, a centered dialog on wide screens. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);
  const drag = useRef<{ y: number; dy: number; at: number } | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Move focus into the dialog, give it back on close, and lock page scroll.
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Dragging the top of the sheet down moves it with the finger; a long or quick pull closes it, otherwise it springs back.
  const dragHandlers = {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      const touch = event.touches[0];
      drag.current = event.touches.length === 1 && touch ? { y: touch.clientY, dy: 0, at: Date.now() } : null;
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const d = drag.current;
      const touch = event.touches[0];
      if (!d || !touch || !dialogRef.current) return;
      d.dy = Math.max(0, touch.clientY - d.y);
      if (motionOK()) gsap.set(dialogRef.current, { y: d.dy });
    },
    onTouchEnd() {
      const d = drag.current;
      drag.current = null;
      const dialog = dialogRef.current;
      if (!d || !dialog || d.dy === 0) return;
      const fast = d.dy / Math.max(1, Date.now() - d.at) > 0.5;
      if (d.dy > 90 || (d.dy > 30 && fast)) {
        if (motionOK()) gsap.to(dialog, { y: '100%', duration: 0.2, ease: 'power2.in', onComplete: () => onCloseRef.current() });
        else onCloseRef.current();
      } else {
        gsap.to(dialog, { y: 0, duration: MOTION.slow, ease: MOTION.spring });
      }
    },
    onTouchCancel() {
      drag.current = null;
      if (dialogRef.current) gsap.to(dialogRef.current, { y: 0, duration: MOTION.fast });
    },
  };

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="sheet stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-head sheet-drag" {...dragHandlers}>
          <h2 id={titleId} className="section-title">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
