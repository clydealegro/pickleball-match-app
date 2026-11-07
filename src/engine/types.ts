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

/** Four players proposed for a court, waiting for the organizer to press Start. No clock runs yet. */
export interface Lineup {
  team1: Team;
  team2: Team;
}

export interface Court {
  id: string;
  number: number;
  /** `ready` holds a `lineup` that has not started; `playing` holds a `game`. */
  status: 'empty' | 'ready' | 'playing';
  /** Remove this court when its current game ends. */
  closing: boolean;
  game?: Game;
  lineup?: Lineup;
}

/** What the organizer recorded when a game finished. Both parts are optional: a result can be skipped. */
export interface GameResult {
  winner: 1 | 2;
  /** Team 1's points, then team 2's. Present only when the organizer gave a score. */
  score?: [number, number];
}

export interface FinishedGame {
  team1: Team;
  team2: Team;
  courtNumber: number;
  startedAt: number;
  finishedAt: number;
  /** Which team won, when a result was recorded. */
  winner?: 1 | 2;
  /** Team 1's points, then team 2's, when a score was recorded. */
  score?: [number, number];
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
  /**
   * False means every game waits for the organizer's Start. Missing or true means games start by themselves, which is
   * how sessions saved before the Ready step behave.
   */
  autoStart?: boolean;
  /** Waiting players the organizer asked to play next, in the order they were asked. Always players who are waiting. */
  pinned?: PlayerId[];
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
  autoStart?: boolean;
}
