import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoError, processPhoto } from '../lib/photo';
import { getRosterPhoto, resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { PhotoPanel } from './PhotoPanel';

vi.mock('../lib/photo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo')>()),
  processPhoto: vi.fn(),
}));

const processed = { type: 'image/jpeg', data: new Uint8Array([1, 2, 3]).buffer };
const file = new File(['x'], 'me.jpg', { type: 'image/jpeg' });

async function setup(withPhoto = false) {
  const ann = await useRosterStore.getState().add('Ann');
  if (withPhoto) await useRosterStore.getState().setPhoto(ann.id, processed);
  const onDone = vi.fn();
  render(<PhotoPanel rosterId={ann.id} name="Ann" onDone={onDone} />);
  return { ann, onDone, user: userEvent.setup() };
}

beforeEach(async () => {
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false, persistent: true });
  vi.mocked(processPhoto).mockReset();
});

describe('PhotoPanel', () => {
  it('opens the front camera for "Take photo" and the library for "Choose from library"', async () => {
    await setup();
    expect(screen.getByLabelText('Take a photo with the camera')).toHaveAttribute('capture', 'user');
    expect(screen.getByLabelText('Choose a photo from the library')).not.toHaveAttribute('capture');
    expect(screen.getByLabelText('Take a photo with the camera')).toHaveAttribute('accept', 'image/*');
  });

  it('shows a preview with a permission reminder, then saves it with "Use photo"', async () => {
    vi.mocked(processPhoto).mockResolvedValue(processed);
    const { ann, onDone, user } = await setup();
    await user.upload(screen.getByLabelText('Take a photo with the camera'), file);

    expect(await screen.findByRole('img', { name: /preview of the new photo for ann/i })).toBeInTheDocument();
    expect(screen.getByText(/with the player's permission/i)).toBeInTheDocument();
    expect(await getRosterPhoto(ann.id)).toBeUndefined(); // nothing saved until confirmed

    await user.click(screen.getByRole('button', { name: 'Use photo' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(Array.from(new Uint8Array((await getRosterPhoto(ann.id))!.data))).toEqual([1, 2, 3]);
    expect(useRosterStore.getState().players[0].photoVersion).toBe(1);
  });

  it('"Retake" goes back without saving anything', async () => {
    vi.mocked(processPhoto).mockResolvedValue(processed);
    const { ann, user } = await setup();
    await user.upload(screen.getByLabelText('Choose a photo from the library'), file);
    await user.click(await screen.findByRole('button', { name: 'Retake' }));

    expect(screen.getByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
  });

  it('shows why a picture failed and leaves the player without a photo', async () => {
    vi.mocked(processPhoto).mockRejectedValue(new PhotoError("That picture couldn't be read."));
    const { ann, onDone, user } = await setup();
    await user.upload(screen.getByLabelText('Take a photo with the camera'), file);

    expect(await screen.findByRole('alert')).toHaveTextContent("That picture couldn't be read.");
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
  });

  it('removes the current photo', async () => {
    const { ann, onDone, user } = await setup(true);
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
    expect(useRosterStore.getState().players[0].photoVersion).toBe(0);
  });

  it('offers no "Remove photo" when there is no photo', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument();
  });

  it('leaves with the done button without changing anything', async () => {
    const { ann, onDone, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(await getRosterPhoto(ann.id)).toBeUndefined();
  });
});
