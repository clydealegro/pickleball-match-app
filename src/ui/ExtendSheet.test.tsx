import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endSession } from '../engine';
import { makeCtx, newTestSession } from '../engine/testing';
import { useSessionStore } from '../store/sessionStore';
import { ExtendSheet } from './ExtendSheet';

const END = new Date(2026, 10, 10, 21, 0).getTime();
const plannedEnd = () => useSessionStore.getState().session?.plannedEndAt;

beforeEach(() => {
  localStorage.clear();
  const session = { ...newTestSession(['A', 'B', 'C', 'D']), plannedEndAt: END };
  useSessionStore.setState({ session, undoStack: [], saveFailed: false, lastAction: null });
});

describe('ExtendSheet', () => {
  it('is a sheet called Extend the session with three choices', () => {
    render(<ExtendSheet onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Extend the session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+15 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+30 min' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+1 hour' })).toBeInTheDocument();
  });

  it.each([
    ['+15 min', 15, 'Extended by 15 minutes'],
    ['+30 min', 30, 'Extended by 30 minutes'],
    ['+1 hour', 60, 'Extended by 1 hour'],
  ])('%s moves the end by exactly that long, labels it and closes', async (name, minutes, label) => {
    const onClose = vi.fn();
    render(<ExtendSheet onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name }));
    expect(plannedEnd()).toBe(END + minutes * 60_000);
    expect(useSessionStore.getState().lastAction?.label).toBe(label);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('can be undone back to the old end', async () => {
    render(<ExtendSheet onClose={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '+30 min' }));
    act(() => useSessionStore.getState().undo());
    expect(plannedEnd()).toBe(END);
  });

  it('closes on Escape and changes nothing', async () => {
    const onClose = vi.fn();
    render(<ExtendSheet onClose={onClose} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(plannedEnd()).toBe(END);
    expect(useSessionStore.getState().undoStack).toHaveLength(0);
  });

  it('shows the reason as an alert and stays open when the session cannot be extended', async () => {
    const session = useSessionStore.getState().session!;
    useSessionStore.setState({ session: endSession(session, makeCtx()) });
    const onClose = vi.fn();
    render(<ExtendSheet onClose={onClose} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '+15 min' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/ended/i);
    expect(onClose).not.toHaveBeenCalled();
  });
});
