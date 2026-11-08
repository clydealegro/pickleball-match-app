import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { PastSessionsScreen } from './PastSessionsScreen';

function entry(id: string, name: string, day: number): HistoryEntry {
  const ctx = makeCtx(1, new Date(2026, 10, day, 18).getTime());
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
  s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + 600_000 });
  s = { ...s, id, name, endedAt: ctx.now + 900_000 };
  return { id, name, createdAt: s.createdAt, endedAt: s.endedAt!, games: 1, session: s };
}

const entries = [entry('b', 'Newer night', 4), entry('a', 'Older night', 1)];

beforeEach(() => {
  useHistoryStore.setState({ entries, loaded: true, persistent: true });
});
afterEach(() => cleanup());

describe('PastSessionsScreen openId', () => {
  it('lists the sessions when no id is given', () => {
    render(<PastSessionsScreen onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    expect(screen.queryByText('Session summary')).not.toBeInTheDocument();
  });

  it('opens that session read-only straight away', () => {
    render(<PastSessionsScreen openId="a" onBack={vi.fn()} />);
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    expect(screen.getByText('Older night')).toBeInTheDocument();
    expect(screen.queryByText('Newer night')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('goes back to the list from the summary, and then back out with the list Back', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<PastSessionsScreen openId="a" onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows the list for an id that is not in history', () => {
    render(<PastSessionsScreen openId="missing" onBack={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
  });

  it('opens the session once history has loaded', () => {
    useHistoryStore.setState({ entries: [], loaded: false });
    render(<PastSessionsScreen openId="b" onBack={vi.fn()} />);
    expect(screen.queryByText('Session summary')).not.toBeInTheDocument();
    act(() => useHistoryStore.setState({ entries, loaded: true }));
    expect(screen.getByText('Session summary')).toBeInTheDocument();
    expect(screen.getByText('Newer night')).toBeInTheDocument();
  });
});
