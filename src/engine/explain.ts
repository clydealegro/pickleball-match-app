import { orderedWaiting } from './pool';
import type { PlayerId, Session } from './types';

export interface WaitingExplanation {
  /** 1 for the player who plays next. */
  position: number;
  reason: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Why a waiting player is where they are in the line, in words an organizer can read out. Null when the player is not
 * waiting (on court, on a break, or gone). Fairness mode compares each player with the one directly ahead, using the
 * same three rules as `compareByPriority`: fewest games, then waiting longest, then the fixed random pick.
 */
export function explainWaiting(s: Session, playerId: PlayerId): WaitingExplanation | null {
  const waiting = orderedWaiting(s);
  const index = waiting.findIndex((p) => p.id === playerId);
  if (index < 0) return null;
  const position = index + 1;
  const me = waiting[index];

  if (waiting.length < 4) {
    return { position, reason: `Waiting for ${plural(4 - waiting.length, 'more player')} to start a game.` };
  }

  if (s.mode === 'queue') {
    return { position, reason: position === 1 ? 'Next in the order people arrived.' : 'In the order people arrived.' };
  }

  const others = waiting.filter((p) => p.id !== me.id);
  if (position === 1) {
    if (me.gamesPlayed < Math.min(...others.map((p) => p.gamesPlayed))) {
      return { position, reason: `Fewest games so far (${me.gamesPlayed}).` };
    }
    const sameGames = others.filter((p) => p.gamesPlayed === me.gamesPlayed);
    if (me.lastFinishedSeq < Math.min(...sameGames.map((p) => p.lastFinishedSeq))) {
      return { position, reason: `Waiting the longest among players with ${plural(me.gamesPlayed, 'game')}.` };
    }
    return { position, reason: 'Tied with others, so the order is a fixed random pick.' };
  }

  const ahead = waiting[index - 1];
  if (ahead.gamesPlayed < me.gamesPlayed) {
    return { position, reason: `Played ${plural(me.gamesPlayed, 'game')}. Players with fewer games go first.` };
  }
  if (ahead.lastFinishedSeq < me.lastFinishedSeq) {
    return { position, reason: 'Same games as the player ahead, who has waited longer.' };
  }
  return { position, reason: 'Tied with the player ahead, so the order is a fixed random pick.' };
}
