export type PlayerId = string;
export type Mode = 'fairness' | 'queue';
export type PlayerStatus = 'active' | 'break' | 'left';
export type Team = [PlayerId, PlayerId];

export interface Player {
  id: PlayerId;
  name: string;
  /** Links to a saved roster entry; used only to look up the photo later. */
  rosterId?: string;
  status: PlayerStatus;
  /** Applies when the player's current game ends. */
  pendingStatus?: 'break' | 'left';
  gamesPlayed: number;
  /** gameSeq when the player last finished a game (or joined / returned). */
  lastFinishedSeq: number;
  /** Stable random value assigned on join; breaks priority ties without flicker. */
  tieKey: number;
  partnerCounts: Record<PlayerId, number>;
  opponentCounts: Record<PlayerId, number>;
}

export interface Game {
  team1: Team;
  team2: Team;
  startedAt: number;
}

export interface Court {
  id: string;
  number: number;
  status: 'empty' | 'playing';
  /** Remove this court when its current game ends. */
  closing: boolean;
  game?: Game;
}

export interface FinishedGame {
  team1: Team;
  team2: Team;
  courtNumber: number;
  startedAt: number;
  finishedAt: number;
}

export interface Session {
  id: string;
  name: string;
  mode: Mode;
  courts: Court[];
  players: Player[];
  /** FIFO order of available players. Maintained in both modes, used in queue mode. */
  queueOrder: PlayerId[];
  history: FinishedGame[];
  /** Increments each time a game finishes. */
  gameSeq: number;
  createdAt: number;
  endedAt?: number;
}

/** Everything non-deterministic is injected so tests can control it. */
export interface Ctx {
  now: number;
  rng: () => number;
  newId: () => string;
}

export interface NewPlayerInput {
  name: string;
  rosterId?: string;
}

export interface NewSessionInput {
  name: string;
  mode: Mode;
  courtCount: number;
  players: NewPlayerInput[];
}
