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

const box = () => screen.getByLabelText('Add players');

describe('the New session page', () => {
  it('keeps matchmaking off the page, with name and courts side by side at the top', () => {
    render(<App />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText('Matchmaking')).not.toBeInTheDocument();
    expect(screen.queryByText(/Simple queue matchmaking/)).not.toBeInTheDocument();
    const top = document.querySelector('.setup-top')!;
    expect(within(top as HTMLElement).getByLabelText('Session name')).toBeInTheDocument();
    expect(within(top as HTMLElement).getByRole('group', { name: 'Courts' })).toBeInTheDocument();
  });

  it('adds a name when Enter is pressed and clears the box, keeping Shift+Enter for a new line', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}');
    await screen.findByRole('checkbox', { name: 'Ann' });
    expect(box()).toHaveValue('');
    await user.type(box(), 'Ben{shift>}{enter}{/shift}Cy');
    expect(box()).toHaveValue('Ben\nCy');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('checkbox', { name: 'Cy' });
    expect(screen.getByRole('checkbox', { name: 'Ben' })).toBeChecked();
    expect(screen.getByText('Players (3 selected)')).toBeInTheDocument();
  });

  it('adds every name of a pasted list', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(box());
    await user.paste('Ann\nBen\nCy\nDee');
    await user.keyboard('{Enter}');
    await screen.findByText('Players (4 selected)');
  });

  it('does not add anything for an empty box', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), '{enter}');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Players (0 selected)')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Saved players' })).not.toBeInTheDocument();
  });

  it('shows saved players as tappable chips with no photo buttons, and a tap toggles the player', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
    await screen.findByText('Players (4 selected)');
    expect(screen.queryByRole('button', { name: /photo/i })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.pick-grid .pick')).toHaveLength(4);
    await user.click(screen.getByText('Ann'));
    expect(screen.getByRole('checkbox', { name: 'Ann' })).not.toBeChecked();
    expect(screen.getByText('Players (3 selected)')).toBeInTheDocument();
  });

  it('only offers Clear once something is selected', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}Ben');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('Players (2 selected)');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('starts new sessions in the mode chosen in Settings, and says so only for the queue', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
    await screen.findByText('Players (4 selected)');
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    expect(screen.getByRole('radio', { name: /fairness/i })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: /simple queue/i }));
    expect(localStorage.getItem('pickleball.mode')).toBe('queue');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Simple queue matchmaking/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start session (4 players)' }));
    await waitFor(() => expect(useSessionStore.getState().session?.mode).toBe('queue'));
  });

  it('starts in fairness by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
    await user.click(await screen.findByRole('button', { name: 'Start session (4 players)' }));
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
