import { useEffect, useRef, useState } from 'react';
import type { Player } from '../engine';
import { boardName, waitingCapacity } from '../store/boardInfo';
import { PlayerAvatar } from './PlayerAvatar';

/** Where nothing has a size (tests): room for six circles. */
const FALLBACK = { width: 6, item: 1, gap: 0 };

/** How many of `total` waiting players fit in the strip, measured from the page. */
function useCapacity(total: number) {
  const strip = useRef<HTMLOListElement>(null);
  const [size, setSize] = useState(FALLBACK);

  useEffect(() => {
    const el = strip.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const first = el.firstElementChild;
      const item = first ? first.getBoundingClientRect().width : 0;
      const width = el.clientWidth;
      if (!item || !width) return setSize(FALLBACK);
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      setSize((old) => (old.width === width && old.item === item && old.gap === gap ? old : { width, item, gap }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [total > 0]);

  return { strip, shown: waitingCapacity(size.width, size.item, size.gap, total) };
}

interface Props {
  waiting: Player[];
  everyone: Player[];
}

/** The strip along the bottom: who is waiting, in the order they will play. */
export function BoardWaiting({ waiting, everyone }: Props) {
  const { strip, shown } = useCapacity(waiting.length);
  const hidden = waiting.length - shown;
  return (
    <section className="board-waiting" aria-label="Waiting">
      <div className="board-wl">
        <span className="board-wl-label">Waiting</span>
        <b className="board-wl-count">{waiting.length}</b>
      </div>
      {waiting.length === 0 ? (
        <p className="board-none">No one is waiting.</p>
      ) : (
        <ol className="board-wstrip" aria-label="Waiting players" ref={strip}>
          {waiting.slice(0, shown).map((p, i) => (
            <li key={p.id} className={`board-wpf${i === 0 ? ' is-first' : ''}`}>
              <div className="board-circle">
                <PlayerAvatar name={p.name} rosterId={p.rosterId} size="fill" />
              </div>
              <span className="board-no">{i + 1}</span>
              <span className="board-pname">{boardName(p, everyone)}</span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="board-wpf board-wmore" aria-label={`${hidden} more waiting`}>
              <div className="board-circle board-more-circle">+{hidden}</div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
