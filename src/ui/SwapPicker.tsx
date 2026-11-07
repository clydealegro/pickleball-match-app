import * as engine from '../engine';
import type { Session } from '../engine';
import { PlayerAvatar } from './PlayerAvatar';
import { Sheet } from './Sheet';

interface Props {
  session: Session;
  playerId: string;
  onPick: (otherId: string) => void;
  onBack: () => void;
  onClose: () => void;
}

/** Who a player can trade places with: the waiting players in line order, then the players on courts. One tap swaps. */
export function SwapPicker({ session, playerId, onPick, onBack, onClose }: Props) {
  const me = session.players.find((p) => p.id === playerId);
  const { waiting, onCourts } = engine.swapCandidates(session, playerId);
  if (!me) return null;
  const empty = waiting.length === 0 && onCourts.length === 0;

  return (
    <Sheet title={`Swap ${me.name}`} onClose={onClose}>
      {empty && <p className="muted">There is nobody to swap with.</p>}

      {waiting.length > 0 && (
        <>
          <h3 className="section-title muted">Waiting</h3>
          <ul className="list" aria-label="Swap with a waiting player">
            {waiting.map((p) => (
              <li key={p.id}>
                <button type="button" className="row-btn" onClick={() => onPick(p.id)}>
                  <PlayerAvatar name={p.name} rosterId={p.rosterId} size="sm" />
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

      {onCourts.length > 0 && (
        <>
          <h3 className="section-title muted">On a court</h3>
          <ul className="list" aria-label="Swap with a player on a court">
            {onCourts.map((o) => (
              <li key={o.player.id}>
                <button type="button" className="row-btn" onClick={() => onPick(o.player.id)}>
                  <PlayerAvatar name={o.player.name} rosterId={o.player.rosterId} size="sm" />
                  <span className="row-name">{o.player.name}</span>
                  <span className="muted swap-where">
                    Court {o.courtNumber}, team {o.team}
                    {o.status === 'ready' ? ', ready' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="btn btn-block" onClick={onBack}>
        Back
      </button>
    </Sheet>
  );
}
