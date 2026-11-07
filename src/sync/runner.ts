import type { SyncOutcome } from './engine';

/** What a finished round reports. `error` means the round itself broke (a bug), not the network or the server. */
export type RoundResult = SyncOutcome | { ok: false; reason: 'error'; pending: number };

export interface RunnerOptions {
  /** One round of sync. */
  run: () => Promise<SyncOutcome>;
  onStart: () => void;
  onResult: (result: RoundResult) => void;
  /** How long to wait between rounds when all is well. */
  intervalMs?: number;
  /** How long to wait after a change before syncing it, so a burst of changes is one round. */
  debounceMs?: number;
}

export interface Runner {
  /** Starts syncing now, and keeps going until `stop`. */
  start(): void;
  stop(): void;
  /** Asks for a round soon: after `delayMs`, and straight away when the connection comes back. */
  poke(delayMs?: number): void;
  /** Resolves when no round is running, straight away if none is. A stopped runner's last round still finishes. */
  idle(): Promise<void>;
}

const INTERVAL_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 2000;
const OFFLINE_RETRY_MS = 30 * 1000;
const AUTH_RETRY_MS = 60 * 1000;
const BACKOFF_START_MS = 5000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * Runs sync rounds one at a time. After a good round it waits for the next change (or the interval); after a failure
 * it waits longer each time. A request made while a round runs makes one more round follow it.
 */
export function createRunner(options: RunnerOptions): Runner {
  const { run, onStart, onResult, intervalMs = INTERVAL_MS, debounceMs = DEBOUNCE_MS } = options;
  let active = false;
  let running = false;
  let again = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Infinity;
  /** Raised by every stop, so the result of a round that was running at the time is thrown away. */
  let generation = 0;
  let inFlight: Promise<void> = Promise.resolve();

  function schedule(delayMs: number) {
    const at = Date.now() + delayMs;
    if (timer !== undefined && at >= dueAt) return; // an earlier round is already planned
    clearTimeout(timer);
    dueAt = at;
    timer = setTimeout(round, delayMs);
  }

  async function round() {
    timer = undefined;
    dueAt = Infinity;
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    const mine = generation;
    onStart();
    let result: RoundResult;
    try {
      const call = run();
      inFlight = call.then(
        () => undefined,
        () => undefined,
      );
      result = await call;
    } catch (error) {
      console.error('Sync stopped by an unexpected error.', error);
      result = { ok: false, reason: 'error', pending: 0 };
    }
    running = false;
    if (mine !== generation || !active) return;
    onResult(result);
    if (result.ok) {
      failures = 0;
      const more = again || result.pending > 0;
      again = false;
      schedule(more ? debounceMs : intervalMs);
    } else if (result.reason === 'otherAccount') {
      // Nothing will change until someone signs out or in; the coordinator starts a new runner then.
    } else if (result.reason === 'offline') {
      again = false;
      schedule(OFFLINE_RETRY_MS);
    } else if (result.reason === 'auth') {
      again = false;
      schedule(AUTH_RETRY_MS);
    } else {
      again = false;
      schedule(Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** failures));
      failures += 1;
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      failures = 0;
      schedule(0);
    },
    stop() {
      active = false;
      generation += 1;
      clearTimeout(timer);
      timer = undefined;
      dueAt = Infinity;
      again = false;
      running = false;
    },
    poke(delayMs = debounceMs) {
      if (!active) return;
      if (running) again = true;
      else schedule(delayMs);
    },
    idle: () => inFlight,
  };
}
