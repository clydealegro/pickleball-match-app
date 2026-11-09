import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../engine/types';
import { useHistoryStore } from '../store/historyStore';
import type { RosterPlayer } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { useSlotsStore } from '../store/slots';
import type { AttendancePrefill } from '../sync/attendance/prefill';
import { setDefaultMode } from './matchmaking';
import type { SessionPlan } from './HomeScreen';
import { SetupScreen } from './SetupScreen';
import { BLANK_SLOTS } from '../store/slotsFixture';

const player = (id: string, name: string): RosterPlayer => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 1 });
const ROSTER = [
  player('ana', 'Ana'),
  player('ben', 'Ben'),
  player('cai', 'Cai'),
  player('dee', 'Dee'),
  player('eli', 'Eli'),
  player('fay', 'Fay'),
  player('gus', 'Gus'),
  player('hal', 'Hal'),
];

const prefill = (over: Partial<AttendancePrefill> = {}): AttendancePrefill => ({
  inIds: ['ana', 'ben', 'cai', 'dee'],
  lateIds: [],
  maybeIds: ['eli', 'fay'],
  friends: [{ id: 'g1', name: 'Rico' }],
  ...over,
});
const plan = (attendance?: AttendancePrefill): SessionPlan => ({ slotId: 'tue', weekday: 2, ...(attendance ? { attendance } : {}) });

beforeEach(() => {
  localStorage.clear();
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useSlotsStore.setState({ slots: BLANK_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useRosterStore.setState({ players: ROSTER, loaded: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(p: SessionPlan) {
  const user = userEvent.setup();
  render(<SetupScreen onManage={vi.fn()} plan={p} />);
  return user;
}
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const group = (title: string) => within(screen.getByRole('heading', { name: title }).closest('section') as HTMLElement);
const session = () => useSessionStore.getState().session as Session;
const byName = (name: string) => session().players.find((p) => p.name === name);
const onCourt = (s: Session) =>
  new Set(s.courts.flatMap((c) => [c.game, c.lineup].flatMap((g) => (g ? [...g.team1, ...g.team2] : []))));

describe('Setup without a prefill', () => {
  it('has no groups, no friends and no extra lines, and nothing is ticked', () => {
    setup(plan());
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('Everyone else')).not.toBeInTheDocument();
    expect(screen.queryByText(/not saved on this phone/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Saved players' })).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
  });

  it('treats a prefill with nothing in it as no prefill', () => {
    setup(plan(prefill({ inIds: [], lateIds: [], maybeIds: [], friends: [] })));
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText('Everyone else')).not.toBeInTheDocument();
  });
});

describe('Setup with a prefill: the groups', () => {
  it('shows the groups in order, with their counts, and the rest of the roster last', () => {
    setup(plan(prefill()));
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual(['Said In, 4', 'Maybe, 2', 'Friends, 1', 'Everyone else']);
  });

  it('puts each player in the right group, and the rest in Everyone else', () => {
    setup(plan(prefill()));
    const names = (title: string) => group(title).getAllByRole('checkbox').map((c) => c.closest('li')!.querySelector('.row-name')!.textContent);
    expect(names('Said In, 4')).toEqual(['Ana', 'Ben', 'Cai', 'Dee']);
    expect(names('Maybe, 2')).toEqual(['Eli', 'Fay']);
    expect(names('Friends, 1')).toEqual(['Rico']);
    expect(names('Everyone else')).toEqual(['Gus', 'Hal']);
  });

  it('ticks Said In and the friends, and leaves Maybe and everyone else unticked', () => {
    setup(plan(prefill()));
    for (const n of ['Ana', 'Ben', 'Cai', 'Dee', 'Rico']) expect(box(n)).toBeChecked();
    for (const n of ['Eli', 'Fay', 'Gus', 'Hal']) expect(box(n)).not.toBeChecked();
  });

  it('counts roster players plus ticked friends, in the header and on the Start button', () => {
    setup(plan(prefill()));
    expect(screen.getByText('5 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start 5 players' })).toBeEnabled();
  });

  it('leaves out a group that is empty', () => {
    setup(plan(prefill({ maybeIds: [], friends: [] })));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Said In, 4', 'Everyone else']);
  });

  it('labels late players, and only them', () => {
    setup(plan(prefill({ lateIds: ['cai'] })));
    expect(within(group('Said In, 4').getByRole('checkbox', { name: 'Cai' }).closest('li') as HTMLElement).getByText('Late, starts on a break')).toBeInTheDocument();
    expect(screen.getAllByText('Late, starts on a break')).toHaveLength(1);
  });

  it('labels the friends', () => {
    setup(plan(prefill()));
    expect(within(group('Friends, 1').getByRole('checkbox', { name: 'Rico' }).closest('li') as HTMLElement).getByText('Friend, tonight only')).toBeInTheDocument();
  });

  it('describes a checkbox by its tag, so the name stays clean', () => {
    setup(plan(prefill({ lateIds: ['cai'] })));
    expect(box('Cai')).toHaveAccessibleDescription('Late, starts on a break');
    expect(box('Rico')).toHaveAccessibleDescription('Friend, tonight only');
  });

  it('says how many who said In are not saved on this phone, and skips them', () => {
    setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'zed', 'yan'] })));
    expect(screen.getByText('2 who said In are not saved on this phone yet.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Said In, 4' })).toBeInTheDocument();
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('uses the singular for one', () => {
    setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'zed'] })));
    expect(screen.getByText('1 who said In is not saved on this phone yet.')).toBeInTheDocument();
  });

  it('shows no such line when everyone is saved', () => {
    setup(plan(prefill()));
    expect(screen.queryByText(/not saved on this phone/)).not.toBeInTheDocument();
  });

  it('still shows the line when nobody who said In is saved', () => {
    setup(plan(prefill({ inIds: ['zed'] })));
    expect(screen.getByText('1 who said In is not saved on this phone yet.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Said In/ })).not.toBeInTheDocument();
  });
});

describe('Setup with a prefill: picking', () => {
  it('unticks a player and updates the count, and the player stays in the group', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Ana'));
    expect(box('Ana')).not.toBeChecked();
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(group('Said In, 4').getByRole('checkbox', { name: 'Ana' })).toBeInTheDocument();
  });

  it('ticks a maybe', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Eli'));
    expect(screen.getByText('6 selected')).toBeInTheDocument();
  });

  it('toggles a friend on and off, and the count follows', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Rico'));
    expect(box('Rico')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Start 4 players' })).toBeEnabled();
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    await user.click(box('Rico'));
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('lets Start through when three players and a friend make four', async () => {
    const user = setup(plan(prefill({ inIds: ['ana', 'ben', 'cai'], maybeIds: [] })));
    expect(screen.getByRole('button', { name: 'Start 4 players' })).toBeEnabled();
    await user.click(box('Rico'));
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
  });

  it('asks for four when fewer are ticked, friends included', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Ana'));
    await user.click(box('Rico'));
    expect(screen.getByRole('button', { name: 'Pick at least 4' })).toBeDisabled();
  });

  it('keeps the friends as they are when Clear, Select all or a shortcut is used', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: 'Rico' }, { id: 'g2', name: 'Zoe' }] })));
    await user.click(box('Zoe'));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(box('Rico')).toBeChecked();
    expect(box('Zoe')).not.toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(box('Rico')).toBeChecked();
    expect(box('Zoe')).not.toBeChecked();
    expect(screen.getByText('9 selected')).toBeInTheDocument();
  });

  it('keeps the friends when Same as last time is used', async () => {
    useRosterStore.setState({ players: ROSTER.map((p) => (p.id === 'gus' || p.id === 'hal' ? { ...p, lastPlayedAt: 5 } : p)) });
    const user = setup(plan(prefill()));
    await user.click(screen.getByRole('button', { name: 'Same as last time (2)' }));
    expect(box('Gus')).toBeChecked();
    expect(box('Ana')).not.toBeChecked();
    expect(box('Rico')).toBeChecked();
  });

  it('searches only Everyone else, and does not claim nobody matches when a grouped player does', async () => {
    const user = setup(plan(prefill()));
    await user.type(screen.getByLabelText('Search or add players'), 'gu');
    expect(group('Everyone else').getAllByRole('checkbox')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Search or add players'));
    await user.type(screen.getByLabelText('Search or add players'), 'ben');
    expect(screen.queryByText('No one matches.')).not.toBeInTheDocument();
  });

  it('puts the groups above the search box', () => {
    setup(plan(prefill()));
    const title = screen.getByRole('heading', { name: 'Said In, 4' });
    const search = screen.getByLabelText('Search or add players');
    expect(title.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Setup with a prefill: starting the session', () => {
  it('starts the ticked roster players with their roster ids and the ticked friends without one', async () => {
    const user = setup(plan(prefill()));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    const players = session().players;
    expect(players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cai', 'Dee', 'Rico']);
    expect(byName('Ana')).toMatchObject({ rosterId: 'ana', status: 'active' });
    expect(byName('Rico')?.rosterId).toBeUndefined();
    expect(byName('Rico')?.status).toBe('active');
  });

  it('starts late players on a break, off the courts, and fills the courts with the others', async () => {
    const user = setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'eli', 'fay'], lateIds: ['fay'], maybeIds: [], friends: [] })));
    await user.click(screen.getByRole('button', { name: 'Start 6 players' }));
    const s = session();
    expect(byName('Fay')).toMatchObject({ status: 'break', rosterId: 'fay' });
    expect(s.queueOrder).not.toContain(byName('Fay')!.id);
    const placed = onCourt(s);
    expect(placed.has(byName('Fay')!.id)).toBe(false);
    expect(placed.size).toBe(4);
    for (const n of ['Ana', 'Ben', 'Cai', 'Dee', 'Eli']) expect(byName(n)!.status).toBe('active');
  });

  it('does not start a late player who was unticked', async () => {
    const user = setup(plan(prefill({ inIds: ['ana', 'ben', 'cai', 'dee', 'eli'], lateIds: ['eli'], maybeIds: [], friends: [] })));
    await user.click(box('Eli'));
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
    expect(byName('Eli')).toBeUndefined();
  });

  it('does not make a late player of a ticked maybe', async () => {
    const user = setup(plan(prefill({ lateIds: ['ana'] })));
    await user.click(box('Eli'));
    await user.click(screen.getByRole('button', { name: 'Start 6 players' }));
    expect(byName('Eli')?.status).toBe('active');
    expect(byName('Ana')?.status).toBe('break');
  });

  it('skips a friend whose name matches a ticked player, ignoring case and spaces, and does not count it', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: '  ana ' }, { id: 'g2', name: 'Rico' }] })));
    expect(screen.getByRole('button', { name: 'Start 5 players' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(session().players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cai', 'Dee', 'Rico']);
  });

  it('skips a friend who matches an earlier friend', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: 'Rico' }, { id: 'g2', name: 'RICO' }] })));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(session().players.filter((p) => p.name.toLowerCase() === 'rico')).toHaveLength(1);
  });

  it('keeps a friend whose name matches a player who is not ticked', async () => {
    const user = setup(plan(prefill({ friends: [{ id: 'g1', name: 'Gus' }] })));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    const gus = byName('Gus');
    expect(gus).toBeDefined();
    expect(gus?.rosterId).toBeUndefined();
  });

  it('does not add a friend to the roster', async () => {
    const add = vi.spyOn(useRosterStore.getState(), 'add');
    const user = setup(plan(prefill()));
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(add).not.toHaveBeenCalled();
    expect(useRosterStore.getState().players).toHaveLength(8);
  });

  it('starts with no friends when they are all unticked', async () => {
    const user = setup(plan(prefill()));
    await user.click(box('Rico'));
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
    expect(byName('Rico')).toBeUndefined();
    expect(session().players).toHaveLength(4);
  });

  it('carries the slot, weekday and venue through, as before', async () => {
    const user = setup({ ...plan(prefill()), venue: 'Hall' });
    await user.click(screen.getByRole('button', { name: 'Start 5 players' }));
    expect(session()).toMatchObject({ slotId: 'tue', weekday: 2, venue: 'Hall' });
  });
});
