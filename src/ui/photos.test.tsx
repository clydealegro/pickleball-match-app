import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processPhoto } from '../lib/photo';
import { getRosterPhoto, resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import { useUpdateStore } from '../pwa';
import App from './App';

vi.mock('../lib/photo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo')>()),
  processPhoto: vi.fn(),
}));

type User = ReturnType<typeof userEvent.setup>;

const processed = { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer };
const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false });
  useUpdateStore.setState({ ready: false, apply: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
  vi.mocked(processPhoto).mockReset();
  vi.mocked(processPhoto).mockResolvedValue(processed);
});

async function addPlayers(user: User, text: string) {
  await user.type(screen.getByLabelText('Add players'), text);
  await user.click(screen.getByRole('button', { name: 'Add' }));
}

/** Takes a photo in the open photo dialog and confirms it. */
async function takeAndUsePhoto(user: User) {
  await user.upload(await screen.findByLabelText('Take a photo with the camera'), file);
  await user.click(await screen.findByRole('button', { name: 'Use photo' }));
}

const rowFor = (listName: string, text: string) =>
  within(screen.getByRole('list', { name: listName }))
    .getAllByRole('listitem')
    .find((li) => within(li).queryByText(text))!;

describe('photos in the app', () => {
  it('adds a photo to a new player from the Setup list', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben');
    await user.click(await screen.findByRole('button', { name: 'Add photo for Ann' }));
    expect(await screen.findByRole('dialog', { name: 'Photo for Ann' })).toBeInTheDocument();

    await takeAndUsePhoto(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(rowFor('Saved players', 'Ann').querySelector('img')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Change photo for Ann' })).toBeInTheDocument();
    expect(rowFor('Saved players', 'Ben').querySelector('img')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ann' })).toBeInTheDocument(); // the row still toggles by name
  });

  it('changes and removes a photo on the Saved players screen', async () => {
    const user = userEvent.setup();
    const ann = await useRosterStore.getState().add('Ann');
    await useRosterStore.getState().setPhoto(ann.id, processed);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Manage saved players' }));
    await waitFor(() => expect(rowFor('Saved players', 'Ann').querySelector('img')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: 'Change photo for Ann' }));
    await user.click(await screen.findByRole('button', { name: 'Remove photo' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add photo for Ann' })).toBeInTheDocument());
    await waitFor(() => expect(rowFor('Saved players', 'Ann').querySelector('img')).toBeNull());
  });

  it('changes a photo from the player sheet during a session, then returns to the sheet', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
    await user.click(await screen.findByRole('button', { name: 'Start session (5 players)' }));

    const waiting = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('listitem')[0];
    const name = within(waiting).getByText(/^(Ann|Ben|Cy|Dee|Eve)$/).textContent!;
    await user.click(within(waiting).getByRole('button'));
    await user.click(await screen.findByRole('button', { name: 'Add photo' }));
    await takeAndUsePhoto(user);

    expect(await screen.findByRole('button', { name: 'Change photo' })).toBeInTheDocument(); // back on the sheet
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(rowFor('Waiting', name).querySelector('img')).not.toBeNull());
  });

  it('photographs a newcomer on the spot from the Add player sheet', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
    await user.click(await screen.findByRole('button', { name: 'Start session (4 players)' }));

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.type(await screen.findByLabelText('New player name'), 'Fay');
    await user.click(screen.getByRole('button', { name: 'Add with photo' }));
    await takeAndUsePhoto(user);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(rowFor('Waiting', 'Fay').querySelector('img')).not.toBeNull());
  });

  it('adds the newcomer without a photo when the organizer skips it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
    await user.click(await screen.findByRole('button', { name: 'Start session (4 players)' }));

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.type(await screen.findByLabelText('New player name'), 'Fay');
    await user.click(screen.getByRole('button', { name: 'Add with photo' }));
    await user.click(await screen.findByRole('button', { name: 'Add without a photo' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rowFor('Waiting', 'Fay').querySelector('img')).toBeNull();
    expect(useRosterStore.getState().players.map((p) => p.name)).toContain('Fay');
  });

  it('keeps a session player usable after their saved entry is deleted', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
    await user.click(await screen.findByRole('button', { name: 'Start session (5 players)' }));
    const waiting = within(screen.getByRole('list', { name: 'Waiting' })).getAllByRole('listitem')[0];
    const name = within(waiting).getByText(/^(Ann|Ben|Cy|Dee|Eve)$/).textContent!;
    const saved = useRosterStore.getState().players.find((p) => p.name === name)!;
    await useRosterStore.getState().remove(saved.id);

    await user.click(within(waiting).getByRole('button'));
    const dialog = await screen.findByRole('dialog', { name });
    expect(within(dialog).queryByRole('button', { name: /photo/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Take a break' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Leave session' })).toBeInTheDocument();
  });

  it('shows a player\'s photo on their court card', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee{enter}Eve');
    await user.click(await screen.findByRole('button', { name: 'Start session (5 players)' }));

    const court = screen.getByRole('tabpanel', { name: 'Court 1' });
    const name = within(court).getAllByText(/^(Ann|Ben|Cy|Dee|Eve)$/)[0].textContent!;
    const chip = () => within(court).getByText(name).closest('.tile')!;
    expect(chip().querySelector('img')).toBeNull(); // initials until there is a photo

    const saved = useRosterStore.getState().players.find((p) => p.name === name)!;
    await act(() => useRosterStore.getState().setPhoto(saved.id, processed));

    await waitFor(() => expect(chip().querySelector('img')).not.toBeNull());
  });

  it('refuses "Add with photo" for someone already in the session and leaves their photo alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
    await waitFor(() => expect(useRosterStore.getState().players).toHaveLength(4)); // the adds are async
    const ann = useRosterStore.getState().players.find((p) => p.name === 'Ann')!;
    await act(() => useRosterStore.getState().setPhoto(ann.id, { type: 'image/jpeg', data: new Uint8Array([9]).buffer }));
    await user.click(await screen.findByRole('button', { name: 'Start session (4 players)' }));

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.type(await screen.findByLabelText('New player name'), 'ann');
    await user.click(screen.getByRole('button', { name: 'Add with photo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ann is already in this session.');
    expect(screen.queryByLabelText('Take a photo with the camera')).not.toBeInTheDocument(); // never reached the photo step
    const stored = await getRosterPhoto(ann.id);
    expect(Array.from(new Uint8Array(stored!.data))).toEqual([9]);
    expect(useRosterStore.getState().players.find((p) => p.id === ann.id)!.photoVersion).toBe(1);
  });

  it('says the newcomer is saved when the photo step is closed without choosing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addPlayers(user, 'Ann{enter}Ben{enter}Cy{enter}Dee');
    await user.click(await screen.findByRole('button', { name: 'Start session (4 players)' }));

    await user.click(screen.getByRole('button', { name: '+ Add player' }));
    await user.type(await screen.findByLabelText('New player name'), 'Fay');
    await user.click(screen.getByRole('button', { name: 'Add with photo' }));
    expect(await screen.findByText(/Fay is saved\./)).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useRosterStore.getState().players.map((p) => p.name)).toContain('Fay');
    expect(screen.queryByText('Fay')).not.toBeInTheDocument(); // saved to the roster, but not in the session
  });
});
