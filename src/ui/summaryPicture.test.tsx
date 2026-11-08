import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import type { CardModel } from './cardModel';
import { SummaryScreen } from './SummaryScreen';

const draw = vi.hoisted(() => ({ renderCardBlob: vi.fn() }));
// The canvas itself is tested in cardDraw.test.ts; here only what the screen hands it and does with the result.
vi.mock('./cardDraw', async (original) => ({ ...(await original<typeof import('./cardDraw')>()), renderCardBlob: draw.renderCardBlob }));

const png = new Blob(['x'], { type: 'image/png' });

beforeEach(async () => {
  localStorage.clear();
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useHistoryStore.setState({ ...useHistoryStore.getInitialState(), entries: [], loaded: false });
  draw.renderCardBlob.mockReset().mockResolvedValue(png);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function finished(winners = false) {
  const ctx = makeCtx(1, 1_000_000);
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
  for (let i = 1; i <= 3; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + i * 12 * 60_000 }, winners ? { winner: 1 } : undefined);
  return { ...s, name: 'Open play', endedAt: ctx.now + 99 };
}

function canShareFiles() {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share, canShare: () => true }));
  return share;
}

const button = () => screen.getByRole('button', { name: /as a picture|making picture/i });
const sheetClosed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

/** Opens the Share sheet from the bar. */
async function openShare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Share' }));
}

describe('Share as a picture', () => {
  it('sits next to As text in the share sheet and hands the picture to the share sheet as a file', async () => {
    const share = canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    expect(screen.getByRole('button', { name: /^as text$|^copy as text$/i })).toBeInTheDocument();
    await user.click(button());
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0] as { files: File[] };
    expect(data.files[0].name).toBe('open-play.png');
    const model = draw.renderCardBlob.mock.calls[0][0] as CardModel;
    expect(model.title).toBe('Open play');
    expect(model.players).toHaveLength(5);
  });

  it('keeps win records off the picture until the wins and losses switch is turned on', async () => {
    canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished(true)} />);
    await openShare(user);
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalledTimes(1));
    expect((draw.renderCardBlob.mock.calls[0][0] as CardModel).players.every((p) => p.record === undefined)).toBe(true);
    await sheetClosed();

    await openShare(user);
    await user.click(screen.getByRole('switch', { name: 'Include wins and losses' }));
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalledTimes(2));
    expect((draw.renderCardBlob.mock.calls[1][0] as CardModel).players.some((p) => p.record !== undefined)).toBe(true);
  });

  it('uses the dark colours when the page is dark', async () => {
    canShareFiles();
    document.documentElement.dataset.theme = 'dark';
    try {
      const user = userEvent.setup();
      render(<SummaryScreen session={finished()} />);
      await openShare(user);
      await user.click(button());
      await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalled());
      expect((draw.renderCardBlob.mock.calls[0][0] as CardModel).palette.bg).toBe('#0f0f0e');
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it('downloads the picture where files cannot be shared, and says so', async () => {
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(button());
    expect(await screen.findByText('Picture saved to this device.')).toBeInTheDocument();
    expect(clicks).toHaveBeenCalledTimes(1);
    await sheetClosed();
  });

  it('counts a shared picture as shared, so Done does not warn', async () => {
    canShareFiles();
    // Not kept in Past sessions, so only having shared can switch the warning off.
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await openShare(user);
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalled());
    await sheetClosed();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('leaves the session unshared when the share sheet is closed', async () => {
    vi.stubGlobal(
      'navigator',
      Object.assign(Object.create(navigator), { share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')), canShare: () => true }),
    );
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(button());
    await sheetClosed();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('says so, and stays usable, when the picture cannot be made', async () => {
    draw.renderCardBlob.mockRejectedValue(new Error('no canvas'));
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(button());
    expect(await screen.findByText('Could not make the picture.')).toBeInTheDocument();
    await sheetClosed();
    await openShare(user);
    expect(button()).toBeEnabled();
  });

  it('shows it is working and ignores a second tap meanwhile', async () => {
    let finish: (b: Blob) => void = () => undefined;
    draw.renderCardBlob.mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve)));
    canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(button());
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent('Making picture…');
    await user.click(button());
    await act(async () => finish(png));
    await sheetClosed();
    expect(draw.renderCardBlob).toHaveBeenCalledTimes(1);
  });

  it('works on a past session opened read-only', async () => {
    canShareFiles();
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} onBack={() => undefined} />);
    await openShare(user);
    await user.click(button());
    await waitFor(() => expect(draw.renderCardBlob).toHaveBeenCalledTimes(1));
  });
});
