import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function openSaved(user: ReturnType<typeof userEvent.setup>, names: string) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names);
  await user.click(await screen.findByRole('button', { name: 'Edit players' }));
  await screen.findByRole('heading', { name: 'Saved players' });
}

describe('Saved players rows', () => {
  it('use icon buttons that keep their accessible names, and no text buttons', async () => {
    const user = userEvent.setup();
    await openSaved(user, 'Cherrylips{enter}Ann{enter}');
    const row = within(screen.getByRole('list', { name: 'Saved players' }).querySelector('li')!);
    const rename = row.getByRole('button', { name: /^Rename / });
    const remove = row.getByRole('button', { name: /^Remove / });
    expect(rename.textContent).toBe('');
    expect(remove.textContent).toBe('');
    expect(rename).toHaveAttribute('title', 'Rename');
    expect(remove).toHaveAttribute('title', 'Remove');
    expect(rename.closest('.saved-actions')).not.toBeNull();
  });

  it('keep the name and the buttons in two separate groups on one row, so a long name cannot push the buttons down', async () => {
    const user = userEvent.setup();
    await openSaved(user, 'Maximilian Featherstonehaugh-Cholmondeley{enter}');
    const li = screen.getByRole('list', { name: 'Saved players' }).querySelector('li')!;
    expect(li).toHaveClass('saved-row');
    expect([...li.children].map((c) => c.className)).toEqual(['saved-who', 'saved-actions']);
    expect(li.querySelector('.saved-who .row-name')!.textContent).toBe('Maximilian Featherstonehaugh-Cholmondeley');
  });

  it('shows a camera badge on avatars without a photo, and none once there is one', async () => {
    const user = userEvent.setup();
    await openSaved(user, 'Ann{enter}Ben{enter}');
    expect(document.querySelectorAll('.cam-badge')).toHaveLength(2);
    act(() => {
      useRosterStore.setState((s) => ({ players: s.players.map((p) => (p.name === 'Ann' ? { ...p, photoVersion: 1 } : p)) }));
    });
    expect(document.querySelectorAll('.cam-badge')).toHaveLength(1);
    const ben = screen.getByRole('button', { name: 'Add photo for Ben' });
    expect(ben.querySelector('.cam-badge')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Change photo for Ann' }).querySelector('.cam-badge')).toBeNull();
  });

  it('show one status line and not the account email, which lives in Settings', async () => {
    const user = userEvent.setup();
    await openSaved(user, 'Ann{enter}');
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });
});
