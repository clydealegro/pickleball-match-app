import * as engine from '../engine';
import type { Session } from '../engine';
import { Avatar } from './Avatar';

interface Props {
  session: Session;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

export function WaitingList({ session, onSelect, onAdd }: Props) {
  const waiting = engine.orderedWaiting(session);
  const onBreak = session.players.filter((p) => p.status === 'break');

  return (
    <section className="card stack" aria-labelledby="waiting-title">
      <h2 id="waiting-title" className="section-title">
        Waiting ({waiting.length})
      </h2>

      {waiting.length === 0 ? (
        <p className="muted">Nobody is waiting.</p>
      ) : (
        <ul className="list" aria-label="Waiting">
          {waiting.map((p, i) => (
            <li key={p.id}>
              <button type="button" className="row-btn" onClick={() => onSelect(p.id)}>
                <span className="row-index muted">{i + 1}</span>
                <Avatar name={p.name} size="sm" />
                <span className="row-name">{p.name}</span>
                <span className="badge">
                  {p.gamesPlayed}
                  <span className="sr-only"> games played</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {onBreak.length > 0 && (
        <>
          <h3 className="section-title muted">On break</h3>
          <ul className="list" aria-label="On break">
            {onBreak.map((p) => (
              <li key={p.id}>
                <button type="button" className="row-btn" onClick={() => onSelect(p.id)}>
                  <Avatar name={p.name} size="sm" />
                  <span className="row-name">{p.name}</span>
                  <span className="badge">
                    {p.gamesPlayed}
                    <span className="sr-only"> games played</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="dashed" onClick={onAdd}>
        + Add player
      </button>
    </section>
  );
}
