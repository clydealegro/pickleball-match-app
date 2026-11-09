import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx, newTestSession } from '../engine/testing';
import type { HistoryEntry } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { DEFAULT_SLOTS, SLOTS_KEY, timestampAt, useSlotsStore, type Slot } from '../store/slots';
import { HomeScreen } from './HomeScreen';

// Saturday 7 Nov 2026, noon. Chips: Sat 7, Tue 10, Thu 12.
const NOW = new Date(2026, 10, 7, 12).getTime();

function resetSlots(slots: Slot[] = DEFAULT_SLOTS.slots) {
  useSlotsStore.setState({ slots: slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
}

beforeEach(() => {
  localStorage.clear();
  resetSlots();
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const onStart = vi.fn();
  const onResume = vi.fn();
  const onHistory = vi.fn();
  const onViewSummary = vi.fn();
  const user = userEvent.setup({ advanceTimers: () => {} });
  const view = render(<HomeScreen onStart={onStart} onResume={onResume} onHistory={onHistory} onViewSummary={onViewSummary} />);
  return { user, onStart, onResume, onHistory, onViewSummary, ...view };
}

const chips = () => within(screen.getByRole('radiogroup', { name: 'Sessions' })).getAllByRole('radio');
const chip = (name: string) => screen.getByRole('radio', { name });
const pill = () => document.querySelector('.home-pill')!.textContent;
const startButton = (day: string) => screen.getByRole('button', { name: `Start session, ${day}` });

describe('HomeScreen chips', () => {
  it('lists the slots soonest first, then the one-off chip', () => {
    setup();
    expect(chips().map((c) => c.getAttribute('aria-label') ?? c.textContent)).toEqual(['Sat 7', 'Tue 10', 'Thu 12', 'One-off session']);
  });

  it('sorts the chips even when the slots are stored in another order', () => {
    resetSlots([
      { id: 'thu', weekday: 4 },
      { id: 'sat', weekday: 6 },
      { id: 'tue', weekday: 2 },
    ]);
    setup();
    expect(chips().map((c) => c.getAttribute('aria-label') ?? c.textContent)).toEqual(['Sat 7', 'Tue 10', 'Thu 12', 'One-off session']);
  });

  it('puts the earlier start first when two slots share a day', () => {
    resetSlots([
      { id: 'late', weekday: 2, startMin: 1140 },
      { id: 'early', weekday: 2, startMin: 600 },
    ]);
    vi.setSystemTime(new Date(2026, 10, 9, 12)); // Monday
    setup();
    // Both chips read "Tue 10"; the earlier session is the first one, so its time shows when it is selected.
    expect(screen.getByText('10:00 am', { exact: false })).toBeInTheDocument();
    expect(chips()[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('is a radio group with one chip checked', () => {
    setup();
    const radios = chips();
    expect(radios).toHaveLength(4);
    expect(radios.filter((c) => c.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(chip('Sat 7')).toHaveAttribute('aria-checked', 'true');
    expect(chip('Tue 10')).toHaveAttribute('aria-checked', 'false');
  });

  it('starts on the next slot: today when it has one, else the next weekday', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
    cleanup();
    vi.setSystemTime(new Date(2026, 10, 9, 12)); // Monday
    setup();
    expect(chip('Tue 10')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday' })).toBeInTheDocument();
  });

  it('switches the hero when another chip is tapped', async () => {
    const { user } = setup();
    await user.click(chip('Thu 12'));
    expect(chip('Thu 12')).toHaveAttribute('aria-checked', 'true');
    expect(chip('Sat 7')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('heading', { level: 1, name: 'Thursday' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Saturday' })).not.toBeInTheDocument();
  });

  it('mounts a fresh hero with the slide-in class on every switch', async () => {
    const { user } = setup();
    const first = document.querySelector('.home-hero')!;
    expect(first).toHaveClass('home-hero-in');
    await user.click(chip('Tue 10'));
    const second = document.querySelector('.home-hero')!;
    expect(second).not.toBe(first);
    expect(second).toHaveClass('home-hero-in');
  });

  it('selects the one-off with the dashed plus chip', async () => {
    const { user } = setup();
    const plus = chip('One-off session');
    expect(plus).toHaveClass('dashed');
    await user.click(plus);
    expect(plus).toHaveAttribute('aria-checked', 'true');
    expect(chip('Sat 7')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('HomeScreen hero', () => {
  it('shows the weekday as the screen title', () => {
    setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
  });

  it('draws the faint court lines and hides them from screen readers', () => {
    setup();
    const svg = document.querySelector('.home-hero svg.home-court')!;
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('asks for a time and a venue with dashed chips when none are set, and never for courts', () => {
    setup();
    for (const label of ['+ Add a time', '+ Add a venue']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('dashed');
    }
    expect(screen.queryByRole('button', { name: '+ Add courts' })).not.toBeInTheDocument();
  });

  it('puts the time beside the day pill', () => {
    resetSlots([{ id: 'sat', weekday: 6, startMin: 540, endMin: 660 }]);
    setup();
    const tags = document.querySelector('.home-hero-top .home-hero-tags')!;
    expect(within(tags as HTMLElement).getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(tags.querySelector('.home-pill')).not.toBeNull();
  });

  it('shows the time, venue and courts when they are set', () => {
    resetSlots([{ id: 'sat', weekday: 6, startMin: 540, endMin: 660, venue: 'Park', courts: 3 }]);
    setup();
    expect(screen.getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(screen.getByText('Park · 3 courts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Add/ })).not.toBeInTheDocument();
  });

  it('says court, not courts, for one court', () => {
    resetSlots([{ id: 'sat', weekday: 6, venue: 'Park', courts: 1 }]);
    setup();
    expect(screen.getByText('Park · 1 court')).toBeInTheDocument();
  });

  it('builds the line from whatever is set and offers a venue chip when there is none', () => {
    resetSlots([{ id: 'sat', weekday: 6, venue: 'Park' }]);
    setup();
    expect(screen.getByText('Park')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add a venue' })).not.toBeInTheDocument();
    cleanup();
    resetSlots([{ id: 'sat', weekday: 6, courts: 2 }]);
    setup();
    expect(screen.getByText('2 courts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add a venue' })).toBeInTheDocument();
  });

  it('shows a one-sided time as the time line', () => {
    resetSlots([{ id: 'sat', weekday: 6, startMin: 1140 }]);
    setup();
    expect(screen.getByText('From 7:00 pm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Add a time' })).not.toBeInTheDocument();
  });

  it('lets this time only values show on the hero', () => {
    useSlotsStore.setState({ tonight: { sat: { venue: 'Elsewhere', courts: 4 } } });
    setup();
    expect(screen.getByText('Elsewhere · 4 courts')).toBeInTheDocument();
  });

  describe('the relative pill', () => {
    const labelFor = (slot: Omit<Slot, 'id' | 'weekday'>) => {
      resetSlots([{ id: 'sat', weekday: 6, ...slot }]);
      setup();
      const text = pill();
      cleanup();
      return text;
    };

    it('says Today with no start time, Tonight for an evening start and Today for an earlier one', () => {
      expect(labelFor({})).toBe('Today');
      expect(labelFor({ startMin: 19 * 60 })).toBe('Tonight');
      expect(labelFor({ startMin: 14 * 60 })).toBe('Today');
    });

    it('counts down in the last hour and then counts up', () => {
      expect(labelFor({ startMin: 12 * 60 + 30 })).toBe('Starts in 30 min');
      expect(labelFor({ startMin: 13 * 60 })).toBe('Starts in 60 min');
      expect(labelFor({ startMin: 11 * 60 + 30 })).toBe('Started 30 min ago');
      expect(labelFor({ startMin: 9 * 60 })).toBe('Started 9:00 am');
    });

    it('says Earlier today once the end has passed', () => {
      expect(labelFor({ startMin: 9 * 60, endMin: 11 * 60 })).toBe('Earlier today');
    });

    it('says Tomorrow and In n days for the other chips', async () => {
      vi.setSystemTime(new Date(2026, 10, 9, 12)); // Monday
      const { user } = setup();
      expect(pill()).toBe('Tomorrow');
      await user.click(chip('Thu 12'));
      expect(pill()).toBe('In 3 days');
      await user.click(chip('Sat 14'));
      expect(pill()).toBe('In 5 days');
    });

    it('follows this time only times', () => {
      resetSlots([{ id: 'sat', weekday: 6, startMin: 9 * 60 }]);
      useSlotsStore.setState({ tonight: { sat: { startMin: 19 * 60 } } });
      setup();
      expect(pill()).toBe('Tonight');
    });
  });

  describe('regulars and the usual turnout', () => {
    const saturdays = [new Date(2026, 9, 31, 18), new Date(2026, 9, 24, 18), new Date(2026, 9, 17, 18)];

    function entry(day: Date, names: string[], withIds = true): HistoryEntry {
      const ctx = makeCtx(1, day.getTime());
      const base = newTestSession(names, { courts: 1 }, ctx);
      const session = {
        ...base,
        id: `s-${day.getTime()}`,
        endedAt: day.getTime() + 3_600_000,
        players: base.players.map((p) => ({ ...p, rosterId: withIds ? `r-${p.name}` : undefined })),
      };
      return { id: session.id, name: 'Open play', createdAt: day.getTime(), endedAt: session.endedAt, games: 3, session };
    }

    function history(names: string[]) {
      useRosterStore.setState({
        players: names.map((n) => ({ id: `r-${n}`, name: n, photoVersion: 0, photoSeq: 0, updatedAt: 0 })),
      });
      useHistoryStore.setState({ entries: saturdays.slice(0, 2).map((d) => entry(d, names)) });
    }

    const avatars = () => document.querySelectorAll('.home-hero .avatar');

    it('shows no stack and no caption without enough history', () => {
      setup();
      expect(avatars()).toHaveLength(0);
      expect(screen.queryByText(/^Usually/)).not.toBeInTheDocument();
    });

    it('stacks the Saturday regulars and says how many usually play', () => {
      history(['Ann', 'Ben', 'Cy']);
      setup();
      expect(avatars()).toHaveLength(3);
      expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
      expect(screen.getByText('Usually 3 play')).toBeInTheDocument();
    });

    it('shows four avatars and then +N', () => {
      history(['Ann', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay']);
      setup();
      expect(avatars()).toHaveLength(4);
      expect(screen.getByText('+2')).toBeInTheDocument();
      expect(screen.getByText('Usually 6 play')).toBeInTheDocument();
    });

    it('gives a range when the turnout varies', () => {
      const names = ['Ann', 'Ben', 'Cy', 'Dee'];
      history(names);
      useHistoryStore.setState({ entries: [entry(saturdays[0], names), entry(saturdays[1], names.slice(0, 2))] });
      setup();
      expect(screen.getByText('Usually 2 to 4 play')).toBeInTheDocument();
    });

    it('follows the selected weekday', async () => {
      history(['Ann', 'Ben', 'Cy']);
      const { user } = setup();
      await user.click(chip('Thu 12'));
      expect(avatars()).toHaveLength(0);
      expect(screen.queryByText(/^Usually/)).not.toBeInTheDocument();
    });

    it('leaves out regulars who are no longer saved players', () => {
      history(['Ann', 'Ben', 'Cy']);
      useRosterStore.setState({ players: [{ id: 'r-Ann', name: 'Ann', photoVersion: 0, photoSeq: 0, updatedAt: 0 }] });
      setup();
      expect(avatars()).toHaveLength(1);
    });

    it('has no stack for sessions of unsaved players but still gives the turnout', () => {
      const names = ['Ann', 'Ben', 'Cy', 'Dee'];
      useHistoryStore.setState({ entries: saturdays.slice(0, 2).map((d) => entry(d, names, false)) });
      setup();
      expect(avatars()).toHaveLength(0);
      expect(screen.getByText('Usually 4 play')).toBeInTheDocument();
    });
  });
});

describe('HomeScreen one-off', () => {
  it('shows a calm hero without a pencil', async () => {
    const { user } = setup();
    await user.click(chip('One-off session'));
    expect(screen.getByRole('heading', { level: 1, name: 'One-off session' })).toBeInTheDocument();
    expect(screen.getByText('Pick who is playing and go.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\+ Add/ })).not.toBeInTheDocument();
    expect(document.querySelector('.home-pill')).toBeNull();
  });

  it('starts it with no plan from a lime button', async () => {
    const { user, onStart } = setup();
    await user.click(chip('One-off session'));
    const button = screen.getByRole('button', { name: 'Start a one-off session' });
    expect(button).toHaveAttribute('data-grade', 'primary');
    await user.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(undefined);
  });
});

describe('HomeScreen Start button', () => {
  it('reads Start {Weekday} session and is named Start session, {Weekday}', async () => {
    const { user } = setup();
    const button = startButton('Saturday');
    expect(button).toHaveTextContent('Start Saturday session');
    await user.click(chip('Thu 12'));
    expect(startButton('Thursday')).toHaveTextContent('Start Thursday session');
    expect(screen.queryByRole('button', { name: 'Start session, Saturday' })).not.toBeInTheDocument();
  });

  it('is the only text button on the screen apart from the dashed chips and the slim row', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Start a one-off session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Past sessions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument();
  });

  it('is primary for a session today and quiet for a later one', async () => {
    const { user } = setup();
    expect(startButton('Saturday')).toHaveAttribute('data-grade', 'primary');
    await user.click(chip('Tue 10'));
    expect(startButton('Tuesday')).toHaveAttribute('data-grade', 'quiet');
  });

  it('is quiet more than 3 hours before the start and primary from exactly 3 hours', () => {
    resetSlots([{ id: 'sat', weekday: 6, startMin: 15 * 60 + 1 }]);
    setup();
    expect(startButton('Saturday')).toHaveAttribute('data-grade', 'quiet');
    cleanup();
    resetSlots([{ id: 'sat', weekday: 6, startMin: 15 * 60 }]);
    setup();
    expect(startButton('Saturday')).toHaveAttribute('data-grade', 'primary');
  });

  it('is primary up to 3 hours after the end and quiet after', () => {
    resetSlots([{ id: 'sat', weekday: 6, startMin: 8 * 60, endMin: 9 * 60 }]);
    setup();
    expect(startButton('Saturday')).toHaveAttribute('data-grade', 'primary');
    cleanup();
    resetSlots([{ id: 'sat', weekday: 6, startMin: 8 * 60, endMin: 9 * 60 - 1 }]);
    setup();
    expect(startButton('Saturday')).toHaveAttribute('data-grade', 'quiet');
  });

  it('grades by this time only times', () => {
    resetSlots([{ id: 'sat', weekday: 6, startMin: 9 * 60 }]);
    useSlotsStore.setState({ tonight: { sat: { startMin: 21 * 60 } } });
    setup();
    expect(startButton('Saturday')).toHaveAttribute('data-grade', 'quiet');
  });

  it('starts the selected slot with its slot and weekday only when nothing is set', async () => {
    const { user, onStart } = setup();
    await user.click(startButton('Saturday'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6 });
  });

  it('starts another slot with its own plan, even when it is quiet', async () => {
    const { user, onStart } = setup();
    await user.click(chip('Thu 12'));
    await user.click(startButton('Thursday'));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'thu', weekday: 4 });
  });

  it('carries the venue and a planned end made from the end time', async () => {
    resetSlots([
      { id: 'sat', weekday: 6, startMin: 540, endMin: 660, venue: 'Park' },
      { id: 'thu', weekday: 4, startMin: 600, venue: 'Hall A' },
    ]);
    const { user, onStart } = setup();
    await user.click(startButton('Saturday'));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'sat', weekday: 6, venue: 'Park', plannedEndAt: timestampAt(660, NOW) });
    await user.click(chip('Thu 12'));
    await user.click(startButton('Thursday'));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'thu', weekday: 4, venue: 'Hall A' });
    expect(onStart.mock.calls[1][0]).not.toHaveProperty('plannedEndAt');
  });

  it('lets this time only values win over the slot', async () => {
    resetSlots([{ id: 'sat', weekday: 6, endMin: 660, venue: 'Park' }]);
    useSlotsStore.setState({ tonight: { sat: { endMin: 1260, venue: 'Hall A' } } });
    const { user, onStart } = setup();
    await user.click(startButton('Saturday'));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6, venue: 'Hall A', plannedEndAt: timestampAt(1260, NOW) });
  });

  it('leaves the planned end out when this time only clears the end', async () => {
    resetSlots([{ id: 'sat', weekday: 6, endMin: 660 }]);
    useSlotsStore.setState({ tonight: { sat: { endMin: undefined } } });
    const { user, onStart } = setup();
    await user.click(startButton('Saturday'));
    expect(onStart.mock.calls[0][0]).not.toHaveProperty('plannedEndAt');
  });

  it('carries the slot courts in the plan', async () => {
    resetSlots([
      { id: 'sat', weekday: 6, courts: 3 },
      { id: 'thu', weekday: 4 },
    ]);
    const { user, onStart } = setup();
    await user.click(startButton('Saturday'));
    expect(onStart).toHaveBeenLastCalledWith({ slotId: 'sat', weekday: 6, courts: 3 });
    await user.click(chip('Thu 12'));
    await user.click(startButton('Thursday'));
    expect(onStart.mock.calls[1][0]).not.toHaveProperty('courts');
  });

  it('lets this time only courts win over the slot, and a this time only clear drop them', async () => {
    resetSlots([{ id: 'sat', weekday: 6, courts: 3 }]);
    useSlotsStore.setState({ tonight: { sat: { courts: 5 } } });
    const first = setup();
    await first.user.click(startButton('Saturday'));
    expect(first.onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6, courts: 5 });
    cleanup();
    useSlotsStore.setState({ tonight: { sat: { courts: undefined } } });
    const second = setup();
    await second.user.click(startButton('Saturday'));
    expect(second.onStart.mock.calls[0][0]).not.toHaveProperty('courts');
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

  it('opens the sheet from the pencil of the selected slot and closes it', async () => {
    const { user } = setup();
    await user.click(chip('Thu 12'));
    const pencil = screen.getByRole('button', { name: 'Edit Thursday' });
    await user.click(pencil);
    expect(screen.getByRole('heading', { name: 'Thursday: when and where' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has one pencil, for the selected slot only', () => {
    setup();
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Edit Saturday' })).toBeInTheDocument();
  });

  it('opens the full sheet from the dashed chip + Add a time', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Add a time' }));
    expect(screen.getByRole('heading', { name: 'Saturday: when and where' })).toBeInTheDocument();
  });

  it('opens the short venue drawer from the dashed chip + Add a venue', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    expect(screen.getByRole('heading', { name: 'Where do you play?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Saturday: when and where' })).not.toBeInTheDocument();
  });

  it('saves for always: the hero updates and the slot is stored', async () => {
    const { user } = setup();
    await editSaturday(user, 'always');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(screen.getByText('Park')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY)!);
    expect(stored.slots.find((s: { id: string }) => s.id === 'sat')).toMatchObject({ startMin: 540, endMin: 660, venue: 'Park' });
  });

  it('saves for this time: the hero updates and the slot is not stored', async () => {
    const { user } = setup();
    await editSaturday(user, 'this-time');
    expect(screen.getByText('9:00 to 11:00 am')).toBeInTheDocument();
    expect(screen.getByText('Park')).toBeInTheDocument();
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')).toEqual({ id: 'sat', weekday: 6 });
    expect(useSlotsStore.getState().tonight.sat).toMatchObject({ startMin: 540, endMin: 660, venue: 'Park' });
    const stored = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? '{"slots":[]}');
    expect(stored.slots.find((s: { id: string }) => s.id === 'sat')).not.toHaveProperty('startMin');
  });

  it('drops the this time only copy when the same slot is saved for always', async () => {
    const { user } = setup();
    await editSaturday(user, 'this-time');
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.click(screen.getByRole('radio', { name: 'Always for Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSlotsStore.getState().tonight.sat).toBeUndefined();
    expect(screen.getByText('Park')).toBeInTheDocument();
  });

  it('keeps the selected slot after saving', async () => {
    const { user } = setup();
    await user.click(chip('Tue 10'));
    await user.click(screen.getByRole('button', { name: 'Edit Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(screen.getByRole('radio', { name: 'Always for Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(chip('Tue 10')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('2 courts')).toBeInTheDocument();
  });

  it('starts with the courts set in the edit sheet', async () => {
    const { user, onStart } = setup();
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(screen.getByRole('radio', { name: 'Always for Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useSlotsStore.getState().slots.find((s) => s.id === 'sat')?.courts).toBe(3);
    await user.click(startButton('Saturday'));
    expect(onStart).toHaveBeenCalledWith({ slotId: 'sat', weekday: 6, courts: 3 });
  });
});

describe('HomeScreen history', () => {
  it('has no last session row: Past sessions live in Settings', () => {
    useHistoryStore.setState({
      entries: [{ id: 'e1', name: 'Open play', createdAt: NOW - 2000, endedAt: NOW - 1000, games: 3, session: newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }) } as HistoryEntry],
      loaded: true,
    });
    setup();
    expect(screen.queryByRole('button', { name: /^Last:/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-last-placeholder')).not.toBeInTheDocument();
  });
});

describe('HomeScreen storage note', () => {
  const note = 'Times and venues cannot be saved in this browser, so they will be forgotten when the app closes.';

  it('is hidden while slots can be saved', () => {
    setup();
    expect(screen.queryByText(note)).not.toBeInTheDocument();
  });

  it('shows when slots cannot be saved', () => {
    useSlotsStore.setState({ persistent: false });
    setup();
    expect(screen.getByRole('status')).toHaveTextContent(note);
  });
});
