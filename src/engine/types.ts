export type PlayerId = string;
export type Mode = 'fairness' | 'queue';
export type PlayerStatus = 'active' | 'break' | 'left';
export type Team = [PlayerId, PlayerId];

export interface Player {
  id: PlayerId;
  name: string;
  /** Links to a saved roster entry; used only to look up the photo later. */
  rosterId?: string;
  /**
   * The organizer's private skill rating, 1 to 10, copied from this device when the player joins. Missing counts as
   * 5. Only the team split reads it. It is never shown on a court, a tile or the summary.
   */
  rating?: number;
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
  /** The slot's weekday, 0 Sunday to 6 Saturday. A slot can start on any day, so this can differ from createdAt. */
  weekday?: number;
  /** The slot this session started from, so its attendance link can be closed when the session ends. */
  slotId?: string;
  endedAt?: number;
  /**
   * False means every game waits for the organizer's Start. Missing or true means games start by themselves, which is
   * how sessions saved before the Ready step behave.
   */
  autoStart?: boolean;
  /** Waiting players the organizer asked to play next, in the order they were asked. Always players who are waiting. */
  pinned?: PlayerId[];
  /** Where the session is played. */
  venue?: string;
  /** When the session is planned to end, as a ms timestamp. Nothing ends the session by itself. */
  plannedEndAt?: number;
}

/** Everything non-deterministic is injected so tests can control it. */
export interface Ctx {
  now: number;
  rng: () => number;
  newId: () => string;
  /** Looks up the organizer's private rating for a saved player. Absent in tests and for organizers who set none. */
  ratingOf?: (rosterId: string) => number | undefined;
}

export interface NewPlayerInput {
  name: string;
  rosterId?: string;
  /** Starts the player on a break: not in the queue until they are set back to active. */
  onBreak?: boolean;
}

export interface NewSessionInput {
  name: string;
  mode: Mode;
  courtCount: number;
  players: NewPlayerInput[];
  autoStart?: boolean;
  venue?: string;
  plannedEndAt?: number;
  /** The slot's weekday, 0 Sunday to 6 Saturday. */
  weekday?: number;
  /** The slot this session started from. A one-off session has none. */
  slotId?: string;
}
