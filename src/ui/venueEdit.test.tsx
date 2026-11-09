import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { useSlotsStore } from '../store/slots';
import { useAuthStore } from '../sync/auth';
import { HomeScreen } from './HomeScreen';

// Saturday 7 Nov 2026, noon: the Saturday slot is selected.
const NOW = new Date(2026, 10, 7, 12).getTime();
const state = () => useSlotsStore.getState();

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'unconfigured', email: null, userId: null, error: null, busy: false });
  useSlotsStore.setState({
    slots: [
      { id: 'sat', weekday: 6, venue: 'Park' },
      { id: 'tue', weekday: 2, venue: 'Park' },
      { id: 'thu', weekday: 4 },
    ],
    venues: ['Park', 'Gym', 'Hall'],
    tonight: {},
    persistent: true,
  });
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openEdit() {
  const user = userEvent.setup({ advanceTimers: () => {} });
  render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /^Park/ }));
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  return user;
}

describe('editing saved places', () => {
  it('shows no Edit link while nothing is saved', async () => {
    useSlotsStore.setState({ venues: [], slots: [{ id: 'sat', weekday: 6 }] });
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '+ Add a venue' }));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('switches to Edit places, with a rename and a remove button on each saved place, and back with Done', async () => {
    const user = await openEdit();
    expect(screen.getByRole('heading', { name: 'Edit places' })).toBeInTheDocument();
    for (const v of ['Park', 'Gym', 'Hall']) {
      expect(screen.getByRole('button', { name: `Rename ${v}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Remove ${v}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { name: 'Where do you play?' })).toBeInTheDocument();
  });

  it('renames a place, and every day that uses it', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Rename Park' }));
    const field = screen.getByLabelText('New name for Park');
    await user.clear(field);
    await user.type(field, 'Park Courts');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(state().venues).toEqual(['Park Courts', 'Gym', 'Hall']);
    expect(state().slots.map((s) => s.venue)).toEqual(['Park Courts', 'Park Courts', undefined]);
    expect(screen.getByRole('button', { name: 'Rename Park Courts' })).toBeInTheDocument();
  });

  it('saves a rename with Enter and cancels it with the cross', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Rename Gym' }));
    await user.type(screen.getByLabelText('New name for Gym'), ' Hall{Enter}');
    expect(state().venues).toContain('Gym Hall');
    await user.click(screen.getByRole('button', { name: 'Rename Hall' }));
    await user.type(screen.getByLabelText('New name for Hall'), 'zzz');
    await user.click(screen.getByRole('button', { name: 'Cancel rename' }));
    expect(state().venues).toContain('Hall');
  });

  it('refuses a duplicate or empty name and says why', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Rename Hall' }));
    const field = screen.getByLabelText('New name for Hall');
    await user.clear(field);
    await user.type(field, 'gym');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Another place already has that name.');
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Type a name for the place.');
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
  });

  it('removes an unused place at once and offers Undo, which puts it back where it was', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Remove Gym' }));
    expect(state().venues).toEqual(['Park', 'Hall']);
    expect(screen.getByRole('status')).toHaveTextContent('Removed Gym');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks before removing a place a day uses, names the days, and leaves those days alone', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Remove Park' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove Park?' });
    expect(dialog).toHaveTextContent('Tuesday and Saturday use this place. They keep showing Park until you pick another.');
    expect(state().venues).toContain('Park');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(state().venues).toEqual(['Gym', 'Hall']);
    expect(state().slots.map((s) => s.venue)).toEqual(['Park', 'Park', undefined]);
    expect(screen.getByRole('status')).toHaveTextContent('Removed Park');
  });

  it('keeps the place on Keep', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Remove Park' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Remove Park?' })).getByRole('button', { name: 'Keep' }));
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
  });

  it('counts a this-time-only venue as in use', async () => {
    useSlotsStore.setState({ tonight: { thu: { venue: 'Hall' } } });
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Remove Hall' }));
    expect(screen.getByRole('dialog', { name: 'Remove Hall?' })).toHaveTextContent('Thursday uses this place. It keeps showing Hall');
  });

  it('adds a place from edit mode with Enter', async () => {
    const user = await openEdit();
    await user.type(screen.getByLabelText('New location'), 'Palo Court{Enter}');
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall', 'Palo Court']);
    expect(screen.getByRole('button', { name: 'Rename Palo Court' })).toBeInTheDocument();
  });

  it('opens in edit mode from the Edit places link in the full sheet', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    render(<HomeScreen onStart={vi.fn()} onResume={vi.fn()} onHistory={vi.fn()} onViewSummary={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Edit Saturday' }));
    await user.click(screen.getByRole('button', { name: 'Edit places' }));
    expect(screen.queryByRole('heading', { name: 'Saturday: when and where' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit places' })).toBeInTheDocument();
  });

  it('keeps a removed place chosen on the day that uses it when picking again', async () => {
    const user = await openEdit();
    await user.click(screen.getByRole('button', { name: 'Remove Park' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Remove Park?' })).getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('radio', { name: 'Park', checked: true })).toBeInTheDocument();
  });
});
