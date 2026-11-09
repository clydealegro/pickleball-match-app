import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, useSlotsStore, type Slot } from '../store/slots';
import { useHistoryStore } from '../store/historyStore';
import { useSessionStore } from '../store/sessionStore';
import { useRosterStore } from '../store/rosterStore';

const seen = vi.hoisted(() => ({ props: [] as { slot: Slot; onSignIn: () => void }[] }));
vi.mock('./AttendanceCard', () => ({
  AttendanceCard: (props: { slot: Slot; onSignIn: () => void }) => {
    seen.props.push(props);
    return null;
  },
}));

import { HomeScreen } from './HomeScreen';

beforeEach(() => {
  localStorage.clear();
  seen.props = [];
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 7, 12));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('what Home hands the attendance card', () => {
  it('gives it the saved slot, not the one with this-time-only edits', () => {
    useSlotsStore.getState().setTonight('sat', { venue: 'Elsewhere', courts: 6 });
    const onSignIn = vi.fn();
    render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} onSignIn={onSignIn} />);
    const last = seen.props[seen.props.length - 1];
    expect(last.slot).toBe(useSlotsStore.getState().slots.find((s) => s.id === 'sat'));
    expect(last.slot.venue).toBeUndefined();
    expect(last.slot.courts).toBeUndefined();
    last.onSignIn();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});
