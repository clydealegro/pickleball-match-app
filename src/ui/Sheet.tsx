import { useEffect, type ReactNode } from 'react';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** A modal panel: a bottom sheet on phones, a centered dialog on wide screens. */
export function Sheet({ title, onClose, children }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet stack"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 className="section-title">{title}</h2>
          <button type="button" className="btn btn-ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
