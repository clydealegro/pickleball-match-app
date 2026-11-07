import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { useSessionStore } from '../store/sessionStore';
import { UndoBar } from './UndoBar';

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState({ session: newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), undoStack: [], saveFailed: false, lastAction: null });
});
afterEach(() => vi.useRealTimers());

const setLast = (label: string, at = Date.now(), id = 1) => act(() => useSessionStore.setState({ lastAction: { id, label, at } }));

describe('UndoBar', () => {
  it('shows nothing until an action has happened', () => {
    render(<UndoBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says what happened in one line, with an Undo button', () => {
    render(<UndoBar />);
    setLast('Game finished on Court 2');
    expect(screen.getByRole('status')).toHaveTextContent('Game finished on Court 2');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('runs Undo from the store and goes away', async () => {
    const undo = vi.fn();
    useSessionStore.setState({ undo });
    render(<UndoBar />);
    setLast('Started Court 1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('goes away by itself after eight seconds, and not before', () => {
    vi.useFakeTimers();
    render(<UndoBar />);
    setLast('Court added');
    act(() => vi.advanceTimersByTime(7_999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts the wait again for a newer action, and shows only the latest', () => {
    vi.useFakeTimers();
    render(<UndoBar />);
    setLast('one', Date.now(), 1);
    act(() => vi.advanceTimersByTime(6_000));
    setLast('two', Date.now(), 2);
    act(() => vi.advanceTimersByTime(6_000));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('two');
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show an action that is already old when it mounts', () => {
    useSessionStore.setState({ lastAction: { id: 1, label: 'Court added', at: Date.now() - 9_000 } });
    render(<UndoBar />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
