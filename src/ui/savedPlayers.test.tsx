import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { renderAtSetup } from '../test/renderAtSetup';

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
  renderAtSetup();
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
    // Ben is saved a moment after Ann, so the second badge can arrive after the screen opens.
    await waitFor(() => expect(document.querySelectorAll('.cam-badge')).toHaveLength(2));
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

describe('adding a player on Saved players', () => {
  it('adds a new player from the field at the top, by button or by Enter', async () => {
    const user = userEvent.setup();
    await openSaved(user, 'Ann{enter}');
    const box = screen.getByLabelText('New player name');
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    await user.type(box, 'Zed');
    expect(add).toBeEnabled();
    await user.click(add);
    expect(await screen.findByRole('button', { name: 'Rename Zed' })).toBeInTheDocument();
    expect(box).toHaveValue('');
    await user.type(box, 'Yan{enter}');
    expect(await screen.findByRole('button', { name: 'Rename Yan' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('saved-row'))).toHaveLength(3);
  });

  it('works when nobody is saved yet, and ignores spaces only', async () => {
    const user = userEvent.setup();
    renderAtSetup();
    await user.click(screen.getByRole('button', { name: /^Settings/ }));
    await user.click(screen.getByRole('button', { name: 'Manage players' }));
    const box = await screen.findByLabelText('New player name');
    await user.type(box, '   ');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.clear(box);
    await user.type(box, 'Ann{enter}');
    expect(await screen.findByRole('button', { name: 'Rename Ann' })).toBeInTheDocument();
    expect(screen.queryByText(/No saved players yet/)).not.toBeInTheDocument();
  });

  it('says so when the name is already saved, and keeps what was typed', async () => {
    const user = userEvent.setup();
    await openSaved(user, 'Ann{enter}');
    const box = screen.getByLabelText('New player name');
    await user.type(box, 'ann{enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ann is already saved.');
    expect(box).toHaveValue('ann');
    expect(screen.getAllByRole('button', { name: /^Rename / })).toHaveLength(1);
  });
});
