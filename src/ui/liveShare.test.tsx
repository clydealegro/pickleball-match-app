import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlotsStore } from '../store/slots';
import { useAttendanceStore } from '../sync/attendance/store';
import { useLiveStore } from '../sync/live/store';
import { LiveNotice, LiveSharePill } from './LiveSharePill';
import { QrCode } from './QrCode';

const URL_OF = (code: string) => `${window.location.origin}/#/j/${code}`;

function seed(over: Partial<ReturnType<typeof useLiveStore.getState>> = {}) {
  useLiveStore.setState({ status: 'on', slotId: 'tue', code: 'c0de', paused: false, showPhotos: true, noticeSeen: true, lastPublishedAt: 1, ...over });
}
function setup() {
  const user = userEvent.setup();
  render(
    <>
      <LiveNotice />
      <LiveSharePill />
    </>,
  );
  return user;
}
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Live board:/ }));
  return screen.getByRole('dialog', { name: 'Live board' });
};

beforeEach(() => {
  localStorage.clear();
  useSlotsStore.setState({ slots: [{ id: 'tue', weekday: 2, venue: 'Nitro' }], venues: [], tonight: {}, persistent: true });
  useAttendanceStore.setState({ links: { tue: { code: 'c0de' } }, ownerId: 'u1', resetLink: vi.fn(async () => ({ ok: true as const })) });
  seed();
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).share;
});

describe('the Live board pill', () => {
  it('is not there while no board is up', () => {
    seed({ status: 'off' });
    setup();
    expect(screen.queryByRole('button', { name: /^Live board:/ })).not.toBeInTheDocument();
  });

  it.each([
    [{ status: 'on' as const, paused: false }, 'On'],
    [{ status: 'paused' as const, paused: true }, 'Paused'],
    [{ status: 'error' as const, paused: false }, 'Offline'],
  ])('says %o as %s', (state, word) => {
    seed(state);
    setup();
    expect(screen.getByRole('button', { name: `Live board: ${word}. Share it.` })).toHaveTextContent(`Live board · ${word}`);
  });
});

describe('the one-time notice', () => {
  it('shows until it is dismissed, and then never again', async () => {
    seed({ noticeSeen: false });
    const user = setup();
    expect(screen.getByRole('status')).toHaveTextContent('Live board is on. Anyone with your link sees names and photos.');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText(/Anyone with your link/)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pickleball.live.v1')!).noticeSeen).toBe(true);
  });

  it('Turn off pauses the board and dismisses the notice', async () => {
    seed({ noticeSeen: false });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(useLiveStore.getState()).toMatchObject({ paused: true, noticeSeen: true });
  });

  it('is not shown with no board, or once seen', () => {
    seed({ status: 'off', noticeSeen: false });
    setup();
    expect(screen.queryByText(/Anyone with your link/)).not.toBeInTheDocument();
  });
});

describe('the share sheet', () => {
  it('says the board is on, and that anyone with the link sees names and photos', async () => {
    const user = setup();
    const sheet = await open(user);
    expect(within(sheet).getByRole('status', { name: '' })).toBeDefined();
    expect(sheet).toHaveTextContent('On. Visitors see the courts and who is waiting.');
    expect(sheet).toHaveTextContent('Tuesday open play');
    expect(sheet).toHaveTextContent('Anyone with the link sees names and photos.');
  });

  it('shares the day\'s link with the share menu', async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const user = setup();
    const sheet = await open(user);
    await user.click(within(sheet).getByRole('button', { name: 'Share link' }));
    expect(share).toHaveBeenCalledWith({ title: 'Tuesday open play', url: URL_OF('c0de') });
  });

  it('copies the link and says so, or says it could not', async () => {
    const user = setup();
    const sheet = await open(user);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
    await user.click(within(sheet).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(URL_OF('c0de'));
    expect(await within(sheet).findByText('Link copied')).toBeInTheDocument();
    writeText.mockRejectedValue(new Error('no'));
    await user.click(within(sheet).getByRole('button', { name: 'Copy link' }));
    expect(await within(sheet).findByText('Could not copy. Select the link below.')).toBeInTheDocument();
  });

  it('disables sharing until the link is ready', async () => {
    useAttendanceStore.setState({ links: {} });
    const user = setup();
    const sheet = await open(user);
    expect(within(sheet).getByRole('button', { name: 'Share link' })).toBeDisabled();
    expect(sheet).toHaveTextContent('Getting the link ready.');
  });

  it('shows a QR full screen, and closes it by tap or Escape', async () => {
    const user = setup();
    const sheet = await open(user);
    await user.click(within(sheet).getByRole('button', { name: 'Show QR' }));
    const screenEl = screen.getByRole('dialog', { name: 'Live board QR code' });
    expect(screenEl).toHaveTextContent('Scan to follow the game');
    expect(screenEl).toHaveTextContent(`/#/j/c0de`);
    await waitFor(() => expect(screenEl.querySelector('svg.qr-screen-code path')).not.toBeNull());
    await user.click(screenEl);
    expect(screen.queryByRole('dialog', { name: 'Live board QR code' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Show QR' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Live board QR code' })).not.toBeInTheDocument();
  });

  it('turns photos off and on', async () => {
    const user = setup();
    const sheet = await open(user);
    const sw = within(sheet).getByRole('switch', { name: 'Show photos' });
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(useLiveStore.getState().showPhotos).toBe(false);
    await user.click(sw);
    expect(useLiveStore.getState().showPhotos).toBe(true);
  });

  it('pauses and resumes, and says which it is', async () => {
    const user = setup();
    const sheet = await open(user);
    await user.click(within(sheet).getByRole('button', { name: 'Pause sharing' }));
    expect(useLiveStore.getState().paused).toBe(true);
    expect(sheet).toHaveTextContent('Paused. Visitors see that the board is paused.');
    await user.click(within(sheet).getByRole('button', { name: 'Resume sharing' }));
    expect(useLiveStore.getState().paused).toBe(false);
  });

  it('says it cannot reach the server', async () => {
    seed({ status: 'error' });
    const user = setup();
    expect(await open(user)).toHaveTextContent('Cannot reach the server. Visitors see the last board.');
  });

  it('keeps Reset link under More, and warns that printed QR codes stop working', async () => {
    const user = setup();
    const sheet = await open(user);
    expect(within(sheet).queryByRole('button', { name: 'Reset link' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'More' }));
    await user.click(within(sheet).getByRole('button', { name: 'Reset link' }));
    const confirm = screen.getByRole('dialog', { name: 'Reset the link?' });
    expect(confirm).toHaveTextContent('Printed QR codes and links already shared will stop working.');
    expect(confirm).toHaveTextContent('Answers are kept.');
    expect(useAttendanceStore.getState().resetLink).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(useAttendanceStore.getState().resetLink).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Reset link' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Reset the link?' })).getByRole('button', { name: 'Reset link' }));
    expect(useAttendanceStore.getState().resetLink).toHaveBeenCalledWith('tue');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reset the link?' })).not.toBeInTheDocument());
  });

  it('shows the message and stays open when the reset fails', async () => {
    useAttendanceStore.setState({ resetLink: vi.fn(async () => ({ ok: false as const, message: 'No connection.' })) });
    const user = setup();
    const sheet = await open(user);
    await user.click(within(sheet).getByRole('button', { name: 'More' }));
    await user.click(within(sheet).getByRole('button', { name: 'Reset link' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Reset the link?' })).getByRole('button', { name: 'Reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection.');
  });

  it('follows the new code after a reset', async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const user = setup();
    const sheet = await open(user);
    act(() => useAttendanceStore.setState({ links: { tue: { code: 'n3w' } } }));
    await user.click(within(sheet).getByRole('button', { name: 'Share link' }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: URL_OF('n3w') }));
  });
});

describe('QrCode', () => {
  it('draws a code for the text, with a label', async () => {
    render(<QrCode text="https://example.com/a" label="QR for a" />);
    // The image is a placeholder until the generator has loaded, so it is looked up again.
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR for a' }).tagName.toLowerCase()).toBe('svg'));
    expect(screen.getByRole('img', { name: 'QR for a' }).querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100);
  });

  it('draws a different code for different text', async () => {
    const { rerender } = render(<QrCode text="https://example.com/a" label="QR" />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR' }).querySelector('path')).not.toBeNull());
    const first = screen.getByRole('img', { name: 'QR' }).querySelector('path')!.getAttribute('d');
    rerender(<QrCode text="https://example.com/b" label="QR" />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'QR' }).querySelector('path')!.getAttribute('d')).not.toBe(first));
  });

  it('is square, with a quiet border and a white background so it scans on any theme', async () => {
    render(<QrCode text="https://example.com/a" label="QR" />);
    const svg = await waitFor(() => {
      const el = screen.getByRole('img', { name: 'QR' });
      if (el.tagName.toLowerCase() !== 'svg') throw new Error('not yet');
      return el;
    });
    const [w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').slice(2).map(Number);
    expect(w).toBe(h);
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
  });
});
