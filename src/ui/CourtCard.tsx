import { gsap } from 'gsap';
import { useLayoutEffect, useRef } from 'react';
import type { Court, Player } from '../engine';
import { courtPanelId } from './CourtTabs';
import { motionOK, MOTION } from './motion';
import { PlayerTile } from './PlayerTile';

interface Props {
  court: Court;
  playersById: Map<string, Player>;
  onFinish: () => void;
  onStart: () => void;
  onSelectPlayer: (id: string) => void;
}

/** The court in focus: who is playing, or who is up next and waiting for Start, and the one thing to do next. */
export function CourtCard({ court, playersById, onFinish, onStart, onSelectPlayer }: Props) {
  const game = court.game;
  const lineup = court.lineup;
  const root = useRef<HTMLElement>(null);
  const seen = useRef<{ who: string; playing: boolean } | null>(null);
  const shown = game ?? lineup;
  const who = shown ? [...shown.team1, ...shown.team2].join(',') : '';
  const playing = !!game;

  // A new line-up deals in, and a game starting pops the same four into place.
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { who, playing };
    const el = root.current;
    if (!before || !el || !who || !motionOK()) return;
    const tiles = el.querySelectorAll('.tile');
    const button = el.querySelector('.btn-finish');
    // A different four, or the same four back up after a finished game, deal in.
    if (before.who !== who || (before.playing && !playing)) {
      gsap.fromTo(tiles, { y: 18, scale: 0.92 }, { y: 0, scale: 1, duration: MOTION.slow + 0.1, ease: MOTION.out, stagger: 0.06, clearProps: 'transform' });
    } else if (playing && !before.playing) {
      gsap.fromTo(tiles, { scale: 0.9 }, { scale: 1, duration: MOTION.slow, ease: MOTION.spring, stagger: 0.05, clearProps: 'transform' });
      gsap.fromTo(el.querySelector('.vs'), { scale: 0.4 }, { scale: 1, duration: MOTION.slow, ease: MOTION.spring, delay: 0.1, clearProps: 'transform' });
      if (button) gsap.fromTo(button, { y: 8 }, { y: 0, duration: MOTION.slow, ease: MOTION.spring, clearProps: 'transform' });
    }
  }, [who, playing]);

  function team(ids: [string, string], number: 1 | 2) {
    const players = ids.flatMap((id) => playersById.get(id) ?? []);
    return (
      <div className={`team team-${number}`} role="group" aria-label={`Team ${number}: ${players.map((p) => p.name).join(' and ')}`}>
        {players.map((p) => (
          <PlayerTile key={p.id} player={p} onClick={() => onSelectPlayer(p.id)} />
        ))}
      </div>
    );
  }

  return (
    <section
      ref={root}
      role="tabpanel"
      id={courtPanelId(court.id)}
      aria-label={`Court ${court.number}`}
      className="card court"
    >
      {game ? (
        <div className="match">
          {team(game.team1, 1)}
          <span className="vs">vs</span>
          {team(game.team2, 2)}
        </div>
      ) : lineup ? (
        <>
          <p className="ready-label">Next up</p>
          <div className="match">
            {team(lineup.team1, 1)}
            <span className="vs">vs</span>
            {team(lineup.team2, 2)}
          </div>
        </>
      ) : (
        <p className="muted court-empty">Waiting for players</p>
      )}

      {court.closing && <span className="tag">Closing after this game</span>}

      {game && (
        <button type="button" className="btn btn-live btn-block btn-finish" onClick={onFinish}>
          Game finished<span className="sr-only"> on court {court.number}</span>
        </button>
      )}

      {lineup && (
        <button type="button" className="btn btn-live btn-block btn-finish" onClick={onStart}>
          Start game<span className="sr-only"> on court {court.number}</span>
        </button>
      )}
    </section>
  );
}
