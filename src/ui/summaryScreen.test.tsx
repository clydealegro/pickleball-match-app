import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useSessionStore } from '../store/sessionStore';
import { SummaryScreen } from './SummaryScreen';

beforeEach(async () => {
  localStorage.clear();
  await resetRosterDbForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function finished(games = 1) {
  const ctx = makeCtx(1, 1_000_000);
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee', 'Eve'], { courts: 1 }, ctx);
  for (let i = 1; i <= games; i++) {
    s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + i * 12 * 60_000 });
  }
  return { ...s, endedAt: ctx.now + 99 };
}

describe('session summary screen', () => {
  it('opens with the facts and one short line per player', () => {
    render(<SummaryScreen session={finished(2)} />);
    const facts = document.querySelector('.sum-stats')!;
    expect(facts.textContent).toContain('Games2');
    expect(facts.textContent).toContain('Time24m');
    expect(facts.textContent).toContain('Players5');
    expect(screen.getByText(/Games per player: \d to \d|Everyone played/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Games per player' })).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps partners and opponents behind each player', async () => {
    const user = userEvent.setup();
    render(<SummaryScreen session={finished()} />);
    const first = document.querySelector('.sum-player') as HTMLDetailsElement;
    expect(first.open).toBe(false);
    await user.click(first.querySelector('summary')!);
    expect(first.open).toBe(true);
    expect(within(first).getByText('Partners')).toBeInTheDocument();
    expect(within(first).getByText('Played against')).toBeInTheDocument();
  });

  it('lists every game in a collapsed log, and hides it when nothing was played', async () => {
    const { unmount } = render(<SummaryScreen session={finished(2)} />);
    const log = document.querySelector('.sum-log') as HTMLDetailsElement;
    expect(log.open).toBe(false);
    expect(screen.getByText('Game by game (2)')).toBeInTheDocument();
    expect(within(log).getAllByRole('listitem')).toHaveLength(2);
    expect(log.textContent).toContain('Court 1 · 12m');
    unmount();
    const ctx = makeCtx();
    render(<SummaryScreen session={{ ...newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx), endedAt: 1 }} />);
    expect(screen.queryByText(/Game by game/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Everyone played|Games per player:/)).not.toBeInTheDocument();
  });

  it('copies the short text when the device cannot share', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Copy results' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).not.toContain('partner');
    expect(await screen.findByText('Copied to clipboard.')).toBeInTheDocument();
  });

  it('uses the share sheet when there is one, and does not complain when it is closed', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new DOMException('closed', 'AbortError'));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Share results' }));
    expect(share).toHaveBeenCalledWith({ title: 'Test', text: expect.stringContaining('Ann: ') });
    await user.click(screen.getByRole('button', { name: 'Share results' }));
    expect(share).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('asks before clearing a summary that was never shared, and not after sharing', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    useSessionStore.setState({ reset });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Share results' }));
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('does not ask when no game was played', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    useSessionStore.setState({ reset });
    const confirm = vi.spyOn(window, 'confirm');
    render(<SummaryScreen session={{ ...newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, makeCtx()), endedAt: 1 }} />);
    await user.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledOnce();
  });
});
