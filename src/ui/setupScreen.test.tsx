import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';
import { getDefaultMode, setDefaultMode } from './matchmaking';

beforeEach(async () => {
  localStorage.clear();
  setDefaultMode('fairness');
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const box = () => screen.getByLabelText('Search or add players');
const four = 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}';

describe('the New session page', () => {
  it('asks who is playing first, with no name field, no cards and no matchmaking choice', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Who’s playing?' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Session name')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(document.querySelector('.setup .card')).toBeNull();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('helps a first-time organizer, then drops the hint and shows the shortcuts once players exist', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText(/Add the people who play regularly/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select all' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit players' })).not.toBeInTheDocument();
    await user.type(box(), 'Ann{enter}');
    await screen.findByRole('checkbox', { name: 'Ann' });
    expect(screen.queryByText(/Add the people who play regularly/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit players' })).toBeInTheDocument();
  });

  it('adds a name when Enter is pressed and clears the box', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}');
    await screen.findByRole('checkbox', { name: 'Ann' });
    expect(box()).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('adds every name of a pasted list', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(box());
    await user.paste('Ann\nBen\nCy\nDee');
    await screen.findByText('4 selected');
    expect(box()).toHaveValue('');
  });

  it('does nothing for an empty box', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), '{enter}');
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved players' })).not.toBeInTheDocument();
  });

  it('filters the chips as you type, and offers to add a name that is not there', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}Ben{enter}Anna{enter}');
    await screen.findByText('3 selected');
    await user.type(box(), 'an');
    const list = within(screen.getByRole('list', { name: 'Saved players' }));
    expect(list.getAllByRole('checkbox').map((c) => c.closest('label')!.querySelector('.row-name')!.textContent)).toEqual(['Ann', 'Anna']);
    expect(list.getByRole('button', { name: '+ Add “an”' })).toBeInTheDocument();
    await user.clear(box());
    await user.type(box(), 'zz');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ Add “zz”' }));
    await screen.findByRole('checkbox', { name: 'zz' });
    expect(box()).toHaveValue('');
  });

  it('Enter on a name that already exists just picks that player, whatever the case', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}');
    await screen.findByRole('checkbox', { name: 'Ann' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('checkbox', { name: 'Ann' })).not.toBeChecked();
    await user.type(box(), 'ANN');
    expect(screen.queryByRole('button', { name: /^\+ Add/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('shows saved players as tappable chips with no photo buttons, and a tap toggles the player', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), four);
    await screen.findByText('4 selected');
    expect(screen.queryByRole('button', { name: /photo/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.pick-grid .pick')).toHaveLength(4);
    await user.click(screen.getByText('Ann'));
    expect(screen.getByRole('checkbox', { name: 'Ann' })).not.toBeChecked();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('only offers Clear once something is selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}Ben{enter}');
    await screen.findByText('2 selected');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('puts courts beside Start, and Start says what is missing, then how many are playing', async () => {
    const user = userEvent.setup();
    render(<App />);
    const bar = document.querySelector<HTMLElement>('.start-bar')!;
    expect(within(bar).getByRole('group', { name: 'Courts' })).toBeInTheDocument();
    expect(within(bar).getByText('2')).toBeInTheDocument();
    const start = within(bar).getByRole('button', { name: 'Pick at least 4' });
    expect(start).toBeDisabled();
    expect(start).not.toHaveClass('btn-live');
    await user.click(within(bar).getByRole('button', { name: 'More courts' }));
    expect(within(bar).getByText('3')).toBeInTheDocument();
    await user.type(box(), four);
    const ready = await within(bar).findByRole('button', { name: 'Start 4 players' });
    expect(ready).toBeEnabled();
    expect(ready).toHaveClass('btn-live');
  });

  it('starts with the courts chosen and a name made from the weekday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 7, 12));
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<App />);
    await user.type(box(), four);
    await user.click(screen.getByRole('button', { name: 'More courts' }));
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    const session = useSessionStore.getState().session!;
    expect(session.courts).toHaveLength(3);
    expect(session.name).toBe('Saturday open play');
    vi.useRealTimers();
  });

  it('starts new sessions in the mode chosen in Settings, and says so only for the queue', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), four);
    await screen.findByText('4 selected');
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(screen.getByRole('radio', { name: /fairness/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /simple queue/i }));
    expect(localStorage.getItem('pickleball.mode')).toBe('queue');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Simple queue matchmaking/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start 4 players' }));
    await waitFor(() => expect(useSessionStore.getState().session?.mode).toBe('queue'));
  });

  it('starts in fairness by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), four);
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    expect(useSessionStore.getState().session?.mode).toBe('fairness');
  });
});

describe('the matchmaking preference', () => {
  it('defaults to fairness and ignores anything unexpected in storage', () => {
    expect(getDefaultMode()).toBe('fairness');
    localStorage.setItem('pickleball.mode', 'nonsense');
    expect(getDefaultMode()).toBe('fairness');
  });

  it('still works for the page when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getDefaultMode()).toBe('fairness');
    setDefaultMode('queue');
    expect(getDefaultMode()).toBe('queue');
    setDefaultMode('fairness');
    expect(getDefaultMode()).toBe('fairness');
    get.mockRestore();
    set.mockRestore();
  });
});
