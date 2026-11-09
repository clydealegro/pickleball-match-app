import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCached } from './cache';
import { memoryRemote, sample } from './fixtures';
import { readPick, savePick } from './identity';
import { MemberPage } from './MemberPage';
import { MemberError, type MemberReason, type MemberRemote } from './remote';

const CODE = 'abc123';
const ANA = 'p01';
const FOUR_TWELVE = new Date(2026, 10, 9, 16, 12).getTime();

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
  document.title = 'PIKLMatch';
  vi.restoreAllMocks();
});

const failing = (reason: MemberReason): MemberRemote => ({
  view: vi.fn(async () => {
    throw new MemberError(reason);
  }),
  answer: vi.fn(async () => undefined),
  addGuest: vi.fn(async () => undefined),
});

describe('the phases', () => {
  it('says this link cannot be opened when the build has no backend', () => {
    render(<MemberPage code={CODE} remote={null} />);
    expect(screen.getByText('This link cannot be opened in this build.')).toBeInTheDocument();
    expect(screen.getByText('PIKL')).toBeInTheDocument();
  });

  it('says it is opening the list while the first request is out', () => {
    const remote: MemberRemote = { ...memoryRemote(), view: () => new Promise(() => undefined) };
    render(<MemberPage code={CODE} remote={remote} />);
    expect(screen.getByText('Opening the list')).toBeInTheDocument();
  });

  it('says the link is not working for an unknown code', async () => {
    const remote: MemberRemote = { ...memoryRemote(), view: async () => null };
    render(<MemberPage code={CODE} remote={remote} />);
    expect(await screen.findByText('This link is not working. Ask your organizer for the new one.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says it could not open the list, with Retry, when the first request fails', async () => {
    render(<MemberPage code={CODE} remote={failing('server')} />);
    expect(await screen.findByText('Could not open the list. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('adds an offline line when the failure was offline', async () => {
    render(<MemberPage code={CODE} remote={failing('offline')} />);
    expect(await screen.findByText('Could not open the list. Try again.')).toBeInTheDocument();
    expect(screen.getByText('You seem to be offline.')).toBeInTheDocument();
  });

  it('opens the list when Retry works', async () => {
    const remote = memoryRemote();
    const view = vi.spyOn(remote, 'view').mockRejectedValueOnce(new MemberError('offline'));
    render(<MemberPage code={CODE} remote={remote} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(view).toHaveBeenCalledTimes(2);
  });
});

describe('the header', () => {
  it('shows PIKL, the title and the when line on the picker', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.getByText('PIKL')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeInTheDocument();
  });

  it('shows the same header on the answer screen, with the when line once', async () => {
    savePick(CODE, ANA);
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getAllByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toHaveLength(1);
  });

  it('sets the page title to the title of the view', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    await screen.findByRole('heading', { name: 'Who are you?' });
    expect(document.title).toBe('Tuesday open play');
  });

  it('leaves the page title alone while there is no view', async () => {
    render(<MemberPage code={CODE} remote={failing('server')} />);
    await screen.findByText('Could not open the list. Try again.');
    expect(document.title).toBe('PIKLMatch');
  });
});

describe('the screens', () => {
  it('shows the picker when nobody is picked', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In' })).toBeNull();
  });

  it('goes straight to the answer screen for a remembered player', async () => {
    savePick(CODE, ANA);
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who are you?' })).toBeNull();
  });

  it('shows the picker again when the remembered player is no longer on the roster', async () => {
    savePick(CODE, 'gone');
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(readPick(CODE)).toBeNull();
  });

  it('shows the cancelled screen, with no picker and no answers, even for a remembered player', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote(sample({ cancelled: { reason: 'Venue is closed for floor repairs.' } }));
    render(<MemberPage code={CODE} remote={remote} />);
    expect(await screen.findByRole('heading', { name: 'No play this Tuesday' })).toBeInTheDocument();
    expect(screen.getByText('Venue is closed for floor repairs.')).toBeInTheDocument();
    expect(screen.getByText('Next session: Tue 17 Nov')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
  });
});

describe('the last list', () => {
  it('shows when it was updated, and that you are offline, when a refresh fails offline', async () => {
    writeCached(CODE, sample(), FOUR_TWELVE);
    render(<MemberPage code={CODE} remote={failing('offline')} />);
    expect(await screen.findByText('Offline, showing the last list')).toBeInTheDocument();
    expect(screen.getByText('Updated 4:12 pm')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('shows only the time for a server failure', async () => {
    writeCached(CODE, sample(), FOUR_TWELVE);
    render(<MemberPage code={CODE} remote={failing('server')} />);
    expect(await screen.findByText('Updated 4:12 pm')).toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it('shows nothing about it once the list is fresh', async () => {
    writeCached(CODE, sample(), FOUR_TWELVE);
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    await screen.findByRole('heading', { name: 'Who are you?' });
    await vi.waitFor(() => expect(screen.queryByText(/^Updated/)).toBeNull());
    expect(screen.queryByText(/Offline/)).toBeNull();
  });
});

describe('the whole path', () => {
  it('opens, picks, answers, changes the answer, brings a friend, asks to join and forgets', async () => {
    const remote = memoryRemote();
    render(
      <StrictMode>
        <MemberPage code={CODE} remote={remote} />
      </StrictMode>,
    );
    // Pick Ana.
    await userEvent.click(await screen.findByRole('button', { name: 'Ana' }));
    expect(await screen.findByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(readPick(CODE)).toBe(ANA);
    expect(screen.getByText("You're in for Tue 10 Nov.")).toBeInTheDocument();

    // Change the answer to Maybe, then Out.
    await userEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(await screen.findByText("You're a maybe for Tue 10 Nov. You can change this any time.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('4 maybe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(await screen.findByText("You're out for Tue 10 Nov.")).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'In' })).queryByText('Ana')).toBeNull();
    expect(screen.getByText('10 people')).toBeInTheDocument();

    // In and late.
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(await screen.findByText("You're in for Tue 10 Nov.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'true');
    expect(remote.data.answers.find((a) => a.player_id === ANA)).toEqual({ player_id: ANA, status: 'in', late: true });

    // Bring a friend.
    await userEvent.click(screen.getByRole('button', { name: 'Bring a friend' }));
    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect((await screen.findAllByText('Added for the organizer to confirm.')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Plus 2 friends')).toBeInTheDocument();

    // Not Ana: back to the picker, and the pick is forgotten.
    await userEvent.click(screen.getByRole('button', { name: 'Not Ana?' }));
    expect(screen.getByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
    expect(readPick(CODE)).toBeNull();

    // Ask to join.
    await userEvent.click(screen.getByRole('button', { name: 'Not on the list? Ask to join.' }));
    await userEvent.type(screen.getByLabelText('Your name'), 'Mika');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thanks. The organizer will see your name.')).toBeInTheDocument();
  });

  it('says there is no connection when an answer cannot be sent, and keeps the old answer', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote();
    vi.spyOn(remote, 'answer').mockRejectedValue(new MemberError('offline'));
    render(<MemberPage code={CODE} remote={remote} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No connection. Try again when you are online.');
    expect(screen.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a success message as a status and a failure as an alert', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote();
    render(<MemberPage code={CODE} remote={remote} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Bring a friend' }));
    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    const shown = await screen.findAllByText('Added for the organizer to confirm.');
    for (const el of shown) expect(el).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the cancelled screen when the week is cancelled while answering', async () => {
    savePick(CODE, ANA);
    const remote = memoryRemote();
    render(<MemberPage code={CODE} remote={remote} />);
    await screen.findByRole('heading', { name: 'Hi Ana' });
    vi.spyOn(remote, 'answer').mockImplementation(async () => {
      remote.data = sample({ cancelled: { reason: null } });
      throw new MemberError('cancelled');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(await screen.findByRole('heading', { name: 'No play this Tuesday' })).toBeInTheDocument();
  });
});
