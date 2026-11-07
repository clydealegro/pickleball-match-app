import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('pickleball.autoStart', 'true'); // these tests are about the live screen, not the Ready step
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const settings = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /^Settings/ }));

describe('Manage players in Settings', () => {
  it('opens Saved players even with nobody saved, and Back returns to Settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await settings(user);
    await user.click(screen.getByRole('button', { name: 'Manage players' }));
    expect(await screen.findByRole('heading', { name: 'Saved players' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Who’s playing?' })).toBeInTheDocument();
  });

  it('still returns to New session when Saved players was opened from there', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}');
    await user.click(await screen.findByRole('button', { name: 'Edit players' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Who’s playing?' })).toBeInTheDocument();
  });

  it('works during a live session, and Back returns to the courts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    await settings(user);
    await user.click(screen.getByRole('button', { name: 'Manage players' }));
    expect(await screen.findByRole('heading', { name: 'Saved players' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('tablist', { name: 'Courts' })).toBeInTheDocument();
  });

  it('is reachable from the summary too, where the account button now opens Settings', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await user.type(screen.getByLabelText('Search or add players'), 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}');
    await user.click(await screen.findByRole('button', { name: 'Start 4 players' }));
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(await screen.findByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
    await settings(user);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Session summary' })).toBeInTheDocument();
  });
});
