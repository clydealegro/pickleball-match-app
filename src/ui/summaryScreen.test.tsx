import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishGame } from '../engine/game';
import { makeCtx, newTestSession } from '../engine/testing';
import { resetHistoryDbForTests } from '../store/historyDb';
import { useHistoryStore } from '../store/historyStore';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useSessionStore } from '../store/sessionStore';
import { SummaryScreen } from './SummaryScreen';

beforeEach(async () => {
  localStorage.clear();
  await resetRosterDbForTests();
  await resetHistoryDbForTests();
  useHistoryStore.setState({ ...useHistoryStore.getInitialState(), entries: [], loaded: false });
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

/** Opens the Share sheet from the bar. */
async function openShare(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Share' }));
  return screen.getByRole('dialog', { name: 'Share this session' });
}

const CONFIRM = 'Close this summary? It could not be saved to Past sessions and you have not shared it yet.';

const NOV_4 = new Date(2026, 10, 4, 12).getTime();

describe('summary header', () => {
  it('puts the session name in the h1, under a small label that says what the page is', () => {
    render(<SummaryScreen session={{ ...finished(1), name: 'Thursday night' }} />);
    const title = screen.getByRole('heading', { level: 1 });
    expect(title).toHaveTextContent('Thursday night');
    expect(screen.queryByRole('heading', { name: 'Session summary' })).not.toBeInTheDocument();
    const label = screen.getByText('Session summary');
    expect(label).toHaveClass('sum-eyebrow');
    expect(label.nextElementSibling).toBe(title);
  });

  it('puts the venue and the start date on one muted line under the name', () => {
    render(<SummaryScreen session={{ ...finished(1), venue: 'Tacloban Sports Hall', createdAt: NOV_4 }} />);
    const meta = document.querySelector('.sum-meta')!;
    expect(meta).toHaveTextContent('Tacloban Sports Hall · Wed 4 Nov');
    expect(meta).toHaveClass('muted');
    expect(meta.previousElementSibling).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('shows only the date when no venue is set', () => {
    render(<SummaryScreen session={{ ...finished(1), createdAt: NOV_4 }} />);
    expect(document.querySelector('.sum-meta')!.textContent).toBe('Wed 4 Nov');
  });

  it('uses the day the session started, not the day it ended', () => {
    render(<SummaryScreen session={{ ...finished(1), createdAt: NOV_4, endedAt: NOV_4 + 3 * 86_400_000 }} />);
    expect(document.querySelector('.sum-meta')!.textContent).toBe('Wed 4 Nov');
  });

  it('puts the human line after the venue and date line', () => {
    render(<SummaryScreen session={{ ...finished(2), createdAt: NOV_4 }} />);
    expect(document.querySelector('.sum-meta')!.nextElementSibling).toBe(document.querySelector('.sum-line'));
  });

  it('no longer repeats the numbers as a games per player line', () => {
    const { unmount } = render(<SummaryScreen session={finished(2)} />);
    expect(screen.queryByText(/Games per player:/)).not.toBeInTheDocument();
    expect(document.querySelector('.sum-fairness')).toBeNull();
    unmount();
    render(<SummaryScreen session={evenGames(2)} />);
    expect(screen.queryByText(/Everyone played/)).not.toBeInTheDocument();
  });
});

/** Four players on one court, so everyone plays every game. */
function evenGames(games: number) {
  const ctx = makeCtx(1, 1_000_000);
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
  for (let i = 1; i <= games; i++) s = finishGame(s, s.courts[0].id, { ...ctx, now: ctx.now + i * 12 * 60_000 });
  return { ...s, endedAt: ctx.now + 99 };
}

describe('the games bars', () => {
  it('shows one bar per player when the games are uneven, as long as the most played fills it', () => {
    render(<SummaryScreen session={finished(1)} />);
    const bars = document.querySelectorAll<HTMLElement>('.sum-bar > span');
    expect(bars).toHaveLength(5);
    expect(Array.from(bars).map((b) => b.style.width).sort()).toEqual(['0%', '100%', '100%', '100%', '100%']);
  });

  it('hides them when everyone played the same number of games, and keeps the counts', () => {
    render(<SummaryScreen session={evenGames(2)} />);
    expect(document.querySelector('.sum-bar')).toBeNull();
    const rows = within(screen.getByRole('list', { name: 'Games per player' })).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.querySelector('.sum-count')!.textContent).toContain('2');
  });

  it('hides them when nobody has played yet, since every count is the same', () => {
    render(<SummaryScreen session={finished(0)} />);
    expect(document.querySelector('.sum-bar')).toBeNull();
  });

  it('shows them when the counts differ by only one game', () => {
    // Five players on one court, three games: the counts are 3 and 2, so they are not all equal.
    render(<SummaryScreen session={finished(3)} />);
    expect(document.querySelectorAll('.sum-bar')).toHaveLength(5);
  });
});

describe('summary highlights', () => {
  it('says the session in a plain line under the name', () => {
    render(<SummaryScreen session={finished(2)} />);
    expect(document.querySelector('.sum-line')!.textContent).toMatch(/^2 games, 24 minutes/);
  });

  it('shows a few highlight lines once there are three games', () => {
    render(<SummaryScreen session={finished(3)} />);
    const list = screen.getByRole('list', { name: 'Highlights' });
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it('shows none for fewer than three games', () => {
    render(<SummaryScreen session={finished(2)} />);
    expect(screen.queryByRole('list', { name: 'Highlights' })).not.toBeInTheDocument();
  });

  it('shows no line for a session with no games', () => {
    render(<SummaryScreen session={finished(0)} />);
    expect(document.querySelector('.sum-line')).toBeNull();
  });
});

describe('session summary screen', () => {
  it('opens with the facts and one short line per player', () => {
    render(<SummaryScreen session={finished(2)} />);
    const facts = document.querySelector('.sum-stats')!;
    expect(facts.textContent).toContain('Games2');
    expect(facts.textContent).toContain('Time24m');
    expect(facts.textContent).toContain('Players5');
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
    const sheet = await openShare(user);
    expect(within(sheet).getByText('Copies it to the clipboard')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Copy as text' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).not.toContain('partner');
    expect(await screen.findByText('Copied to clipboard.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says could not copy, and closes the sheet, when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect(await screen.findByText('Could not copy automatically.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the share sheet when there is one, and closes the Share sheet after', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<SummaryScreen session={finished()} />);
    const sheet = await openShare(user);
    expect(within(sheet).getByText('For a group chat')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'As text' }));
    expect(share).toHaveBeenCalledWith({ title: 'Test', text: expect.stringContaining('Ann: ') });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not complain, and does not count it as shared, when the share sheet is closed', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    // Not kept in Past sessions, so only having shared can switch the Done warning off.
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(screen.getByRole('button', { name: 'As text' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('falls back to the clipboard when the share sheet fails for another reason', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('nope')), clipboard: { writeText } });
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(screen.getByRole('button', { name: 'As text' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(await screen.findByText('Copied to clipboard.')).toBeInTheDocument();
  });

  it('asks before clearing a summary that was never shared, and not after sharing', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    useSessionStore.setState({ reset });
    // History could not keep it, so the summary is the only copy.
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(CONFIRM);
    expect(reset).not.toHaveBeenCalled();
    await openShare(user);
    await user.click(screen.getByRole('button', { name: 'As text' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('does not ask once the session is kept in Past sessions', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    useSessionStore.setState({ reset });
    const confirm = vi.spyOn(window, 'confirm');
    render(<SummaryScreen session={finished()} />);
    await vi.waitFor(() => expect(useHistoryStore.getState().entries).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('shows a past session read-only: no save, no Done, only Share in the bar, a Back button', async () => {
    const user = userEvent.setup();
    const back = vi.fn();
    render(<SummaryScreen session={finished()} onBack={back} />);
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
    expect(within(document.querySelector<HTMLElement>('.sum-actions')!).getAllByRole('button').map((b) => b.textContent)).toEqual(['Share']);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalledOnce();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('does not ask when no game was played', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    useSessionStore.setState({ reset });
    const confirm = vi.spyOn(window, 'confirm');
    render(<SummaryScreen session={{ ...newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, makeCtx()), endedAt: 1 }} />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledOnce();
  });

  it('does not reset when the confirm is declined, and resets when it is accepted', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    useSessionStore.setState({ reset });
    useHistoryStore.setState({ save: vi.fn().mockResolvedValue(undefined) });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<SummaryScreen session={finished()} />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has Share and Done side by side in one bar, Share first, and no other button in it', () => {
    render(<SummaryScreen session={finished()} />);
    const bar = document.querySelector<HTMLElement>('.sum-actions')!;
    expect(bar).toHaveClass('sticky-bar');
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Share', 'Done']);
    expect(within(bar).getByRole('button', { name: 'Share' })).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('retires the three old buttons and the old switch', () => {
    render(<SummaryScreen session={withResults()} />);
    for (const name of ['Share results', 'Copy results', 'Share as picture', 'Start new session']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});

describe('the share sheet', () => {
  it('opens from Share with the two options, and closes with its own close button without sharing anything', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<SummaryScreen session={finished()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const sheet = await openShare(user);
    expect(within(sheet).getByRole('button', { name: 'As a picture' })).toBeEnabled();
    expect(within(sheet).getByText('The card with highlights and photos')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'As text' })).toBeEnabled();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(share).not.toHaveBeenCalled();
  });

  it('shows messages as a status above the bar', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<SummaryScreen session={finished()} />);
    await openShare(user);
    await user.click(screen.getByRole('button', { name: 'Copy as text' }));
    const status = await screen.findByRole('status');
    const bar = document.querySelector('.sum-actions')!;
    expect(status.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/** Two games with results and one without, on one court. */
function withResults() {
  const ctx = makeCtx(1, 1_000_000);
  let s = newTestSession(['Ann', 'Ben', 'Cy', 'Dee'], { courts: 1 }, ctx);
  const id = (name: string) => s.players.find((p) => p.name === name)!.id;
  const play = (t1: [string, string], t2: [string, string], at: number, result?: Parameters<typeof finishGame>[3]) => {
    s.courts[0].game = { team1: [id(t1[0]), id(t1[1])], team2: [id(t2[0]), id(t2[1])], startedAt: at };
    s = finishGame(s, s.courts[0].id, { ...ctx, now: at + 600_000 }, result);
  };
  play(['Ann', 'Ben'], ['Cy', 'Dee'], 1_000_000, { winner: 1, score: [11, 7] });
  play(['Ann', 'Cy'], ['Ben', 'Dee'], 2_000_000, { winner: 2 });
  play(['Ann', 'Dee'], ['Ben', 'Cy'], 3_000_000);
  return { ...s, endedAt: 4_000_000 };
}

describe('results on the summary', () => {
  it('shows each player’s record under their name, only for players who have one', () => {
    render(<SummaryScreen session={withResults()} />);
    const rows = within(screen.getByRole('list', { name: 'Games per player' })).getAllByRole('listitem');
    const ann = rows.find((r) => r.textContent!.startsWith('AN') || r.textContent!.includes('Ann'))!;
    expect(ann.textContent).toContain('1W 1L');
    expect(rows.find((r) => r.textContent!.includes('Dee'))!.textContent).toContain('1W 1L');
  });

  it('shows no record at all when no game had a result', () => {
    render(<SummaryScreen session={finished(2)} />);
    expect(document.querySelector('.sum-record')).toBeNull();
  });

  it('opens a player to their record and how they did with each partner', async () => {
    const user = userEvent.setup();
    render(<SummaryScreen session={withResults()} />);
    const row = within(screen.getByRole('list', { name: 'Games per player' })).getAllByRole('listitem').find((r) => r.textContent!.includes('Ann'))!;
    await user.click(row.querySelector('summary')!);
    expect(within(row).getByText('Record')).toBeInTheDocument();
    expect(within(row).getByText('1 win, 1 loss')).toBeInTheDocument();
    // Ben and Cy partnered Ann in games with a result, Dee in the game without one.
    expect(within(row).getByText('Partners').nextElementSibling!.textContent).toBe('Ben · 1W 0L, Cy · 0W 1L, Dee');
  });

  it('writes the result under each game in the game by game list', async () => {
    const user = userEvent.setup();
    render(<SummaryScreen session={withResults()} />);
    await user.click(screen.getByText('Game by game (3)'));
    const log = document.querySelector('.sum-log')!;
    expect(log.textContent).toContain('Ann & Ben won 11 to 7');
    expect(log.textContent).toContain('Ben & Dee won');
    expect(within(log as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
    expect(log.querySelectorAll('.sum-log-result')).toHaveLength(2); // the third game had no result
  });

  it('offers to include wins and losses in the sheet only when there are some, off by default', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SummaryScreen session={withResults()} />);
    const sheet = await openShare(user);
    expect(within(sheet).getByRole('switch', { name: 'Include wins and losses' })).not.toBeChecked();
    unmount();
    render(<SummaryScreen session={finished(2)} />);
    const plain = await openShare(user);
    expect(within(plain).queryByRole('switch')).not.toBeInTheDocument();
  });

  it('turns the switch off again every time the sheet opens', async () => {
    const user = userEvent.setup();
    render(<SummaryScreen session={withResults()} />);
    let sheet = await openShare(user);
    await user.click(within(sheet).getByRole('switch', { name: 'Include wins and losses' }));
    expect(within(sheet).getByRole('switch')).toBeChecked();
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    sheet = await openShare(user);
    expect(within(sheet).getByRole('switch')).not.toBeChecked();
  });

  it('leaves results out of the shared text by default, and adds them when switched on', async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { share }));
    render(<SummaryScreen session={withResults()} />);
    await openShare(user);
    await user.click(screen.getByRole('button', { name: 'As text' }));
    expect(share.mock.calls[0][0].text).not.toMatch(/\dW \dL/);
    await openShare(user);
    await user.click(screen.getByRole('switch', { name: 'Include wins and losses' }));
    await user.click(screen.getByRole('button', { name: 'As text' }));
    expect(share.mock.calls[1][0].text).toMatch(/Ann: 3 · 1W 1L/);
  });
});
