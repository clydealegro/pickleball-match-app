import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { DEFAULT_SLOTS, timestampAt, useSlotsStore } from '../store/slots';
import { pastSession, seed } from '../test/historyFixtures';
import App from './App';
import { SetupScreen } from './SetupScreen';
import { setDefaultMode } from './matchmaking';

// Friday 13 Nov 2026, noon. The Thursday slot is not today.
const FRIDAY = new Date(2026, 10, 13, 12);

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true');
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  useHistoryStore.setState({ entries: [], loaded: false, persistent: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FRIDAY);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const setup = () => userEvent.setup({ advanceTimers: () => {} });
const four = 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}';
const box = () => screen.getByLabelText('Search or add players');
const click = (user: ReturnType<typeof setup>, name: string | RegExp) => user.click(screen.getByRole('button', { name }));
// On Friday 13 Nov the chips read Sat 14, Tue 17 and Thu 19.
const startThursday = async (user: ReturnType<typeof setup>) => {
  await user.click(screen.getByRole('radio', { name: 'Thu 19' }));
  await click(user, 'Start session, Thursday');
};
const startOneOff = async (user: ReturnType<typeof setup>) => {
  await user.click(screen.getByRole('radio', { name: 'One-off session' }));
  await click(user, 'Start a one-off session');
};

describe('Home is the landing screen', () => {
  it('shows Home first, with no Who’s playing form', () => {
    render(<App />);
    expect(screen.getByRole('radio', { name: 'One-off session' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who’s playing?' })).not.toBeInTheDocument();
  });

  it('opens Who’s playing from a slot, named for that slot’s weekday', async () => {
    const user = setup();
    render(<App />);
    await startThursday(user);
    expect(screen.getByRole('heading', { level: 1, name: 'Who’s playing?' })).toBeInTheDocument();
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session!.name).toBe('Thursday open play');
  });

  it('shows the slot’s venue and time under the title', async () => {
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, startMin: 1140, endMin: 1260, venue: 'Hall A' }] });
    const user = setup();
    render(<App />);
    await startThursday(user);
    expect(screen.getByText('Hall A · 7:00 to 9:00 pm')).toBeInTheDocument();
  });

  it('starts Who’s playing from the slot courts, and the session gets that many courts', async () => {
    localStorage.setItem('pickleball.courts', '2');
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, courts: 3 }] });
    const user = setup();
    render(<App />);
    await startThursday(user);
    expect(screen.getByRole('group', { name: 'Courts' }).querySelector('.stepper-value')).toHaveTextContent('3');
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session!.courts).toHaveLength(3);
  });

  it('stores the venue and planned end on the session', async () => {
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, startMin: 1140, endMin: 1260, venue: 'Hall A' }] });
    const user = setup();
    render(<App />);
    await startThursday(user);
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    const s = useSessionStore.getState().session!;
    expect(s.venue).toBe('Hall A');
    expect(s.plannedEndAt).toBe(timestampAt(1260, FRIDAY.getTime()));
  });

  it('uses this time only values for the session and then forgets them', async () => {
    useSlotsStore.setState({ slots: [{ id: 'thu', weekday: 4, venue: 'Hall A' }], tonight: { thu: { venue: 'Park' } } });
    const user = setup();
    render(<App />);
    await startThursday(user);
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session!.venue).toBe('Park');
    expect(useSlotsStore.getState().tonight).toEqual({});
  });

  it('leaves venue and planned end off a one-off session', async () => {
    const user = setup();
    render(<App />);
    await startOneOff(user);
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    const s = useSessionStore.getState().session!;
    expect(s.name).toBe('Friday open play');
    expect(s).not.toHaveProperty('venue');
    expect(s).not.toHaveProperty('plannedEndAt');
  });

  it('uses the slot’s weekday for the regulars shortcut, not today’s', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 5); // Thursdays
    await pastSession(group, ids, 2026, 10, 12);
    const user = setup();
    render(<App />);
    await startThursday(user);
    expect(await screen.findByRole('button', { name: 'Thursday regulars (4)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Friday regulars/ })).not.toBeInTheDocument();
  });

  it('goes back to Home from Who’s playing', async () => {
    const user = setup();
    render(<App />);
    await startThursday(user);
    await click(user, 'Back');
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who’s playing?' })).not.toBeInTheDocument();
  });

  it('shows Back on a one-off session’s Who’s playing too', async () => {
    const user = setup();
    render(<App />);
    await startOneOff(user);
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('returns to Home from Settings opened on Home', async () => {
    const user = setup();
    render(<App />);
    await click(user, 'Settings');
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await click(user, 'Back');
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('returns to Who’s playing from Settings opened there, keeping the form', async () => {
    const user = setup();
    render(<App />);
    await startOneOff(user);
    await user.type(box(), 'Ann{enter}');
    await screen.findByRole('checkbox', { name: 'Ann' });
    await click(user, /^Settings/);
    await click(user, 'Back');
    expect(screen.getByRole('heading', { name: 'Who’s playing?' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
  });

  it('returns to Home from Past sessions opened on Home', async () => {
    const group = ['Ann', 'Ben', 'Cy', 'Dee'];
    const ids = await seed(group);
    await pastSession(group, ids, 2026, 10, 5);
    const user = setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Last:/ }));
    expect(screen.getByRole('heading', { name: 'Past sessions' })).toBeInTheDocument();
    await click(user, 'Back');
    expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });

  it('lands on Home after Start new session on the summary', async () => {
    const ended = { ...newTestSession(['A', 'B', 'C', 'D'], { courts: 1 }), endedAt: Date.now() };
    useSessionStore.setState({ session: ended });
    const user = setup();
    render(<App />);
    await click(user, 'Start new session');
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Who’s playing?' })).not.toBeInTheDocument();
  });

  it('lands on Home after Start new session even if Who’s playing was open before', async () => {
    const user = setup();
    render(<App />);
    await startOneOff(user);
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    act(() => useSessionStore.setState((st) => ({ session: { ...st.session!, endedAt: Date.now() } })));
    await user.click(await screen.findByRole('button', { name: 'Start new session' }));
    expect(await screen.findByRole('radiogroup', { name: 'Sessions' })).toBeInTheDocument();
  });
});

describe('SetupScreen props', () => {
  it('has no Back button unless it is given one', () => {
    render(<SetupScreen onManage={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('calls onBack from the Back button', async () => {
    const onBack = vi.fn();
    const user = setup();
    render(<SetupScreen onManage={() => {}} onBack={onBack} />);
    await click(user, 'Back');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('starts the court count from the plan when it has courts', () => {
    localStorage.setItem('pickleball.courts', '2');
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2, courts: 5 }} />);
    expect(screen.getByRole('group', { name: 'Courts' }).querySelector('.stepper-value')).toHaveTextContent('5');
  });

  it('starts the court count from the saved preference when the plan has none', () => {
    localStorage.setItem('pickleball.courts', '4');
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2 }} />);
    expect(screen.getByRole('group', { name: 'Courts' }).querySelector('.stepper-value')).toHaveTextContent('4');
  });

  it('shows only the venue when the plan has a venue but no time', () => {
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2, venue: 'Park' }} />);
    expect(screen.getByText('Park')).toBeInTheDocument();
  });

  it('shows the planned end when the slot is not known', () => {
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2, plannedEndAt: timestampAt(1260, FRIDAY.getTime()) }} />);
    expect(screen.getByText('Until 9:00 pm')).toBeInTheDocument();
  });

  it('shows no line under the title when the plan has nothing to say', () => {
    render(<SetupScreen onManage={() => {}} plan={{ slotId: 'x', weekday: 2 }} />);
    expect(document.querySelector('.setup-plan')).toBeNull();
  });
});
