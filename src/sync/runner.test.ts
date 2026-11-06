import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOutcome } from './engine';
import { createRunner, type RoundResult } from './runner';

const ok = (pending = 0): SyncOutcome => ({ ok: true, pushed: 0, pulled: 0, skippedRows: 0, pending });
const bad = (reason: 'offline' | 'auth' | 'server' | 'otherAccount'): SyncOutcome => ({ ok: false, reason, pending: 1 });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A runner whose rounds return the outcomes given in order (the last one repeats), and that records what happened. */
function setup(outcomes: SyncOutcome[], options: { hold?: boolean } = {}) {
  const log: string[] = [];
  const results: RoundResult[] = [];
  let n = 0;
  let release: (() => void) | undefined;
  const run = vi.fn(async () => {
    log.push(`run@${Date.now()}`);
    const outcome = outcomes[Math.min(n++, outcomes.length - 1)];
    if (options.hold) await new Promise<void>((resolve) => (release = resolve));
    return outcome;
  });
  const runner = createRunner({ run, onStart: () => log.push('start'), onResult: (r) => results.push(r) });
  return { runner, run, results, log, release: () => release?.() };
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe('the sync runner', () => {
  it('runs a round as soon as it starts, and then waits five minutes', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not start twice', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits two seconds after a change, and joins a burst of changes into one round', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke();
    await vi.advanceTimersByTimeAsync(1500);
    runner.poke();
    await vi.advanceTimersByTimeAsync(499);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lets a request for now beat a request for later, but not the other way round', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke(10 * SECOND);
    runner.poke(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    runner.poke(0);
    runner.poke(10 * SECOND);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9 * SECOND);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('follows a round with one more when a change came in while it ran, and when it left changes waiting', async () => {
    const { runner, run, release } = setup([ok(), ok(1), ok(0)], { hold: true });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(2 * SECOND);
    expect(run).toHaveBeenCalledTimes(3);
    release();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('never runs two rounds at once', async () => {
    const { runner, run, release } = setup([ok()], { hold: true });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke(0);
    runner.poke(0);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(run).toHaveBeenCalledTimes(1);
    release();
  });

  it('tries again after 30 seconds with no connection, and after a minute when the session is not accepted', async () => {
    const offline = setup([bad('offline'), ok()]);
    offline.runner.start();
    await vi.advanceTimersByTimeAsync(29 * SECOND);
    expect(offline.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(offline.run).toHaveBeenCalledTimes(2);

    const auth = setup([bad('auth'), ok()]);
    auth.runner.start();
    await vi.advanceTimersByTimeAsync(59 * SECOND);
    expect(auth.run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1 * SECOND);
    expect(auth.run).toHaveBeenCalledTimes(2);
  });

  it('waits longer after each failure from the server, up to five minutes, and starts over after a good round', async () => {
    const { runner, run, log } = setup([bad('server'), bad('server'), bad('server'), ok(), bad('server')]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    const gaps: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = run.mock.calls.length;
      let waited = 0;
      while (run.mock.calls.length === before) {
        await vi.advanceTimersByTimeAsync(SECOND);
        waited += SECOND;
      }
      gaps.push(waited);
    }
    expect(gaps).toEqual([5 * SECOND, 10 * SECOND, 20 * SECOND]);
    expect(log.filter((l) => l.startsWith('run'))).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5 * MINUTE); // the good round, then the interval
    expect(run).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(5 * SECOND); // failures start from five seconds again
    expect(run).toHaveBeenCalledTimes(6);
  });

  it('caps the wait after repeated failures at five minutes', async () => {
    const { runner, run } = setup([bad('server')]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) await vi.advanceTimersByTimeAsync(5 * MINUTE);
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(run.mock.calls.length).toBe(calls + 1);
  });

  it('stops trying when another account owns this device', async () => {
    const { runner, run, results } = setup([bad('otherAccount')]);
    runner.start();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(run).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('reports a round that broke, and keeps going with a delay', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const results: RoundResult[] = [];
    const run = vi.fn().mockRejectedValueOnce(new Error('bug')).mockResolvedValue(ok());
    const runner = createRunner({ run, onStart: () => undefined, onResult: (r) => results.push(r) });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual([{ ok: false, reason: 'error', pending: 0 }]);
    await vi.advanceTimersByTimeAsync(5 * SECOND);
    expect(run).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('stops for good, throws away the result of a round still running, and can start again', async () => {
    const { runner, run, results, release } = setup([ok()], { hold: true });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    release();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(results).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    runner.poke(0);
    await vi.advanceTimersByTimeAsync(10 * SECOND);
    expect(run).toHaveBeenCalledTimes(1);

    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
  });

  it('throws away the result of a round from before a stop, even after starting again', async () => {
    const releases: (() => void)[] = [];
    const results: RoundResult[] = [];
    const run = vi.fn(
      () =>
        new Promise<SyncOutcome>((resolve) => {
          releases.push(() => resolve(ok()));
        }),
    );
    const runner = createRunner({ run, onStart: () => undefined, onResult: (r) => results.push(r) });
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    releases[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual([]);
    releases[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toHaveLength(1);
  });

  it('cancels a round that was planned but has not started when it stops', async () => {
    const { runner, run } = setup([ok()]);
    runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.poke(5 * SECOND);
    runner.stop();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
