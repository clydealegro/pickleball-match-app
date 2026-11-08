import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { DEFAULT_SLOTS, SLOTS_KEY, timestampAt, useSlotsStore } from '../store/slots';
import { HomeScreen } from './HomeScreen';

// Saturday 7 Nov 2026, noon.
const NOW = new Date(2026, 10, 7, 12).getTime();

function resetSlots(slots = DEFAULT_SLOTS.slots) {
  useSlotsStore.setState({ slots: slots.map((s) => ({ ...s })), venues: [], tonight: {} });
}

beforeEach(() => {
  localStorage.clear();
  resetSlots();
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const onStart = vi.fn();
  const onHistory = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={onStart} onHistory={onHistory} />);
  return { user, onStart, onHistory };
}

const card = (day: string) => screen.getByRole('heading', { name: new RegExp(`^${day}`) }).closest('section')!;

describe('HomeScreen cards', () => {
  it('makes today the big card and the other slots small cards', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Saturday open play' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Tuesday' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Thursday' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Saturday' })).not.toBeInTheDocument();
  });

  it('makes the next weekday with a slot the big card when today has none', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 12)); // Monday
    setup();
    expect(screen.getByRole('heading', { level: 2, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Tuesday')).toBeInTheDocument();
    expect(within(card('Tuesday')).queryByText('Today')).not.toBeInTheDocument();
  });

  it('labels today as Today', () => {
    setup();
    expect(within(card('Saturday')).getByText('Today')).toBeInTheDocument();
  });

  it('asks for a time and a venue when none is set', () => {
    setup();
    expect(within(card('Saturday')).getByText('Add a time')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Add a venue')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Add a time')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Add a venue')).toBeInTheDocument();
  });

  it('shows the time and venue when they are set', () => {
    resetSlots([
      { id: 'tue', weekday: 2, startMin: 1140, endMin: 1260, venue: 'Hall A' },
      { id: 'sat', weekday: 6, startMin: 540, endMin: 660, venue: 'Park' },
    ]);
    setup();
    expect(within(card('Saturday')).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Park')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('7:00 to 9:00 pm')).toBeInTheDocument();
    expect(within(card('Tuesday')).getByText('Hall A')).toBeInTheDocument();
    expect(screen.queryByText('Add a time')).not.toBeInTheDocument();
  });

  it('shows the this time only tag when tonight overrides a slot', () => {
    useSlotsStore.setState({ tonight: { thu: { venue: 'Elsewhere' } } });
    setup();
    expect(within(card('Thursday')).getByText('This time only')).toBeInTheDocument();
    expect(within(card('Thursday')).getByText('Elsewhere')).toBeInTheDocument();
    expect(within(card('Tuesday')).queryByText('This time only')).not.toBeInTheDocument();
    expect(within(card('Saturday')).queryByText('This time only')).not.toBeInTheDocument();
  });
});

describe('HomeScreen editing', () => {
  async function editSaturday(user: ReturnType<typeof userEvent.setup>, scope: 'always' | 'this-time') {
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.type(screen.getByLabelText('Start time'), '09:00');
    await user.type(screen.getByLabelText('End time'), '11:00');
    await user.type(screen.getByLabelText('New venue'), 'Park{enter}');
    if (scope === 'always') await user.click(screen.getByRole('radio', { name: 'Always for Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
  }

  it('opens the sheet for that card and closes it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit Thursday' }));
    expect(screen.getByRole('heading', { name: 'Thursday: when and where' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves for always: the card updates and the slot is stored', async () => {
    const { user } = setup();
    await editSaturday(user, 'always');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(card('Saturday')).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Park')).toBeInTheDocument();
    expect(within(card('Saturday')).queryByText('This time only')).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY)!);
    expect(stored.slots.find((s: { id: string }) => s.id === 'sat')).toMatchObject({ startMin: 540, endMin: 660, venue: 'Park' });
  });

  it('saves for this time: the card updates, shows the tag, and the slot is not stored', async () => {
    const { user } = setup();
    await editSaturday(user, 'this-time');
    expect(within(card('Saturday')).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(within(card('Saturday')).getByText('This time only')).toBeInTheDocument();
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')).toEqual({ id: 'sat', weekday: 6 });
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '{"slots":[]}');
    expect(stored.slots.find((s: { id: string }) => s.id === 'sat')).not.toHaveProperty('startMin');
  });

  it('drops the this time only tag when the same slot is saved for always', async () => {
    const { user } = setup();
    await editSaturday(user, 'this-time');
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.click(screen.getByRole('radio', { name: 'Always for Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(within(card('Saturday')).queryByText('This time only')).not.toBeInTheDocument();
    expect(within(card('Saturday')).getByText('Park')).toBeInTheDocument();
  });
});

describe('HomeScreen starting', () => {
  it('starts the big card with its slot and weekday only when nothing is set', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6 });
  });

  it('starts a small card with its own slot, on any day', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Thursday session' }));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'thu', weekday: 4 });
  });

  it('carries the venue and a planned end made from the end time', async () => {
    resetSlots([
      { id: 'sat', weekday: 6, startMin: 540, endMin: 660, venue: 'Park' },
      { id: 'thu', weekday: 4, startMin: 600, venue: 'Hall A' },
    ]);
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'sat', weekday: 6, venue: 'Park', plannedEndAt: timestampAt(660, NOW) });
    await user.click(screen.getByRole('button', { name: 'Start Thursday session' }));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'thu', weekday: 4, venue: 'Hall A' });
    expect(onStart.mock.calls[1][0]).not.toHaveProperty('plannedEndAt');
  });

  it('lets this time only values win over the slot', async () => {
    resetSlots([{ id: 'sat', weekday: 6, endMin: 660, venue: 'Park' }]);
    useSlotsStore.setState({ tonight: { sat: { endMin: 1260, venue: 'Hall A' } } });
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6, venue: 'Hall A', plannedEndAt: timestampAt(1260, NOW) });
  });

  it('leaves the planned end out when this time only clears the end', async () => {
    resetSlots([{ id: 'sat', weekday: 6, endMin: 660 }]);
    useSlotsStore.setState({ tonight: { sat: { endMin: undefined } } });
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start Saturday session' }));
    expect(onStart.mock.calls[0][0]).not.toHaveProperty('plannedEndAt');
  });

  it('starts a one-off session with no plan', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Start a one-off session' }));
    expect(onStart).toHaveBeenCalledWith(undefined);
  });
});

describe('HomeScreen history and settings', () => {
  const entry = (endedAt: number, games: number): HistoryEntry => ({
    id: `e${endedAt}`,
    name: 'Open play',
    createdAt: endedAt - 1000,
    endedAt,
    games,
    session: newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }),
  });

  it('shows no last session line and no Past sessions button without history', () => {
    setup();
    expect(screen.queryByText(/^Last:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Past sessions' })).not.toBeInTheDocument();
  });

  it('shows the newest session and opens Past sessions when history exists', async () => {
    useHistoryStore.setState({ entries: [entry(new Date(2026, 10, 4, 21).getTime(), 7), entry(new Date(2026, 10, 1, 21).getTime(), 3)] });
    const { user, onHistory } = setup();
    expect(screen.getByText('Last: Wed 4 Nov, 7 games')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Past sessions' }));
    expect(onHistory).toHaveBeenCalledTimes(1);
  });

  it('says game, not games, for one game', () => {
    useHistoryStore.setState({ entries: [entry(new Date(2026, 10, 4, 21).getTime(), 1)] });
    setup();
    expect(screen.getByText('Last: Wed 4 Nov, 1 game')).toBeInTheDocument();
  });
});
