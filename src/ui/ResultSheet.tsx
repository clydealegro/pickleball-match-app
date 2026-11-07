import { useState } from 'react';
import type { GameResult } from '../engine';
import { Sheet } from './Sheet';

interface Props {
  courtNumber: number;
  team1: string[];
  team2: string[];
  /** 11, 15 or 21: where the winner's score starts. */
  playTo: number;
  /** Called with the result, or with nothing when it is skipped. */
  onSave: (result?: GameResult) => void;
  /** Close without finishing the game. */
  onClose: () => void;
}

const join = (names: string[]) => names.join(' and ');

/**
 * Who won, then the score, with no typing: two team buttons, then a stepper for the winning score and a row of numbers
 * for the losing score. A tap on a number saves. Skipping is always possible, and closing leaves the game running.
 */
export function ResultSheet({ courtNumber, team1, team2, playTo, onSave, onClose }: Props) {
  const [winner, setWinner] = useState<1 | 2 | null>(null);
  const [winning, setWinning] = useState(playTo);

  if (winner === null) {
    return (
      <Sheet title={`Court ${courtNumber}: who won?`} onClose={onClose}>
        <div className="result-teams">
          <button type="button" className="btn btn-block result-team" onClick={() => setWinner(1)}>
            {join(team1)}
          </button>
          <button type="button" className="btn btn-block result-team" onClick={() => setWinner(2)}>
            {join(team2)}
          </button>
        </div>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => onSave()}>
          Skip result
        </button>
      </Sheet>
    );
  }

  const winners = winner === 1 ? team1 : team2;
  const losers = winner === 1 ? team2 : team1;
  // Losing scores run up to just under the winning one, and past the target when the winner is past it.
  const top = Math.max(playTo - 1, winning - 1);
  const chips = Array.from({ length: top + 1 }, (_, n) => n);
  const save = (losing: number) => onSave({ winner, score: winner === 1 ? [winning, losing] : [losing, winning] });

  return (
    <Sheet title={`Court ${courtNumber}: score`} onClose={onClose}>
      <p className="result-label" id="winning-label">
        {join(winners)} won with
      </p>
      <div className="result-winning" role="group" aria-labelledby="winning-label">
        <button type="button" className="btn icon-btn" aria-label="Lower the winning score" disabled={winning <= 1} onClick={() => setWinning(winning - 1)}>
          −
        </button>
        <output className="result-number" aria-live="polite">
          {winning}
        </output>
        <button type="button" className="btn icon-btn" aria-label="Raise the winning score" disabled={winning >= 99} onClick={() => setWinning(winning + 1)}>
          +
        </button>
      </div>

      <p className="result-label" id="losing-label">
        {join(losers)} scored
      </p>
      <div className="score-chips" role="group" aria-labelledby="losing-label">
        {chips.map((n) => (
          <button key={n} type="button" className="btn score-chip" disabled={n >= winning} onClick={() => save(n)}>
            {n}
          </button>
        ))}
      </div>

      <div className="result-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setWinner(null)}>
          Change winner
        </button>
      </div>
      {/* Skipping the score is allowed but not encouraged: a small quiet link, set apart from the numbers. */}
      <button type="button" className="skip-link" onClick={() => onSave({ winner })}>
        Skip score
      </button>
    </Sheet>
  );
}
