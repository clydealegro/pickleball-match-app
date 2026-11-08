import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Court, Session, Team } from '../engine';
import { makeCtx, newTestSession } from '../engine/testing';
import { LiveHero } from './HomeLive';

const SEC = 1000;
const MIN = 60 * SEC;
const NOW = new Date(2026, 10, 7, 11).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A session with `n` empty courts; `edit` changes them. */
function withCourts(n: number, edit: (courts: Court[]) => Court[] = (c) => c): Session {
  const s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: Math.max(n, 1), autoStart: false }, makeCtx(1, NOW - 60 * MIN));
  return { ...s, courts: edit(s.courts.slice(0, n).map((c) => ({ ...c, status: 'empty' as const, game: undefined, lineup: undefined, closing: false }))) };
}

/** A court that is playing a game begun `ago` ms ago. */
function playing(court: Court, ago: number): Court {
  const team = ['a', 'b'] as Team;
  return { ...court, status: 'playing', game: { team1: team, team2: team, startedAt: NOW - ago } };
}

const list = () => screen.getByRole('list', { name: 'Courts' });
const rows = () => within(list()).getAllByRole('listitem').map((li) => li.textContent);

describe('the courts list on the Live hero', () => {
  it('shows Open, Ready and Playing for the three states', () => {
    const s = withCourts(3, (c) => [
      { ...c[0], status: 'ready' },
      playing(c[1], 3 * MIN),
      c[2],
    ]);
    render(<LiveHero session={s} />);
    expect(rows()).toEqual(['Court 1Ready', 'Court 2Playing, 3 min', 'Court 3Open']);
  });

  it('puts the court name and its state in separate elements', () => {
    render(<LiveHero session={withCourts(1)} />);
    const [li] = within(list()).getAllByRole('listitem');
    expect(within(li).getByText('Court 1')).toBeInTheDocument();
    expect(within(li).getByText('Open')).toBeInTheDocument();
  });

  it('rounds the minutes down: 8 min 30 s shows 8', () => {
    render(<LiveHero session={withCourts(1, (c) => [playing(c[0], 8 * MIN + 30 * SEC)])} />);
    expect(rows()).toEqual(['Court 1Playing, 8 min']);
  });

  it('shows at least 1 min: 20 s shows 1', () => {
    render(<LiveHero session={withCourts(1, (c) => [playing(c[0], 20 * SEC)])} />);
    expect(rows()).toEqual(['Court 1Playing, 1 min']);
  });

  it('updates the minutes after the one-minute timer fires', () => {
    render(<LiveHero session={withCourts(1, (c) => [playing(c[0], 8 * MIN + 30 * SEC)])} />);
    expect(rows()).toEqual(['Court 1Playing, 8 min']);
    act(() => {
      vi.advanceTimersByTime(MIN);
    });
    expect(rows()).toEqual(['Court 1Playing, 9 min']);
  });

  it('lists courts in court-number order', () => {
    const s = withCourts(3, (c) => [c[2], c[0], c[1]]);
    render(<LiveHero session={s} />);
    expect(rows()).toEqual(['Court 1Open', 'Court 2Open', 'Court 3Open']);
  });

  it('shows Closing instead of the state for a closing court', () => {
    const s = withCourts(3, (c) => [
      { ...playing(c[0], 8 * MIN), closing: true },
      { ...c[1], status: 'ready', closing: true },
      { ...c[2], closing: true },
    ]);
    render(<LiveHero session={s} />);
    expect(rows()).toEqual(['Court 1Closing', 'Court 2Closing', 'Court 3Closing']);
  });

  it('shows four rows and a +N more courts row for six courts', () => {
    render(<LiveHero session={withCourts(6)} />);
    expect(rows()).toEqual(['Court 1Open', 'Court 2Open', 'Court 3Open', 'Court 4Open', '+2 more courts']);
  });

  it('shows all four rows and no more row for exactly four courts', () => {
    render(<LiveHero session={withCourts(4)} />);
    expect(rows()).toHaveLength(4);
    expect(screen.queryByText(/more court/)).not.toBeInTheDocument();
  });

  it('says +1 more court for five courts', () => {
    render(<LiveHero session={withCourts(5)} />);
    expect(rows().at(-1)).toBe('+1 more court');
  });

  it('is absent when the session has no courts', () => {
    render(<LiveHero session={withCourts(0)} />);
    expect(screen.queryByRole('list', { name: 'Courts' })).not.toBeInTheDocument();
  });

  it('has the accessible name Courts', () => {
    render(<LiveHero session={withCourts(2)} />);
    expect(list().tagName).toBe('UL');
  });
});
