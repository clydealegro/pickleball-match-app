import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceViewData } from '../sync/attendance/types';
import * as download from './download';
import { sample } from './fixtures';
import { MemberAnswer } from './MemberAnswer';

const ANA = 'p01';
const OK = { ok: true as const, message: 'Added for the organizer to confirm.' };

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

interface Options {
  view?: AttendanceViewData;
  me?: string;
  busy?: boolean;
  message?: { text: string; ok: boolean } | null;
}
function setup({ view = sample(), me = ANA, busy = false, message = null }: Options = {}) {
  const onAnswer = vi.fn();
  const onForget = vi.fn();
  const onAddFriend = vi.fn(async () => OK);
  render(<MemberAnswer view={view} me={me} busy={busy} message={message} onAnswer={onAnswer} onForget={onForget} onAddFriend={onAddFriend} />);
  return { onAnswer, onForget, onAddFriend };
}
/** The view with one player's answer changed. */
const answered = (id: string, status: 'in' | 'maybe' | 'out', late = false) => {
  const base = sample();
  return sample({ answers: [...base.answers.filter((a) => a.player_id !== id), { player_id: id, status, late }] });
};
/** The view with no answer from one player. */
const unanswered = (id: string) => sample({ answers: sample().answers.filter((a) => a.player_id !== id) });

describe('the greeting', () => {
  it('says Hi with the first name, and leaves the when line to the page header', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Hi Ana' })).toBeInTheDocument();
    expect(screen.queryByText('Tue 10 Nov, 7 to 9 pm, Sample Hall')).toBeNull();
  });

  it('uses the first name only, even when the list shows a last initial', () => {
    setup({ me: 'p02' });
    expect(screen.getByRole('heading', { name: 'Hi Ben' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not Ben?' })).toBeInTheDocument();
  });

  it('offers Not Ana? and forgets on a tap', async () => {
    const { onForget } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Not Ana?' }));
    expect(onForget).toHaveBeenCalledTimes(1);
  });
});

describe('the answer', () => {
  it('shows In, Maybe and Out, and marks the current one pressed', () => {
    setup();
    expect(screen.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Out' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks Maybe and Out when those are the answer', () => {
    const { unmount } = render(
      <MemberAnswer view={answered(ANA, 'maybe')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Maybe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'In' })).toHaveAttribute('aria-pressed', 'false');
    unmount();
    render(<MemberAnswer view={answered(ANA, 'out')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Out' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks nothing before the first answer, and shows no banner', () => {
    setup({ view: unanswered(ANA) });
    for (const name of ['In', 'Maybe', 'Out']) expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/^You're/)).toBeNull();
  });

  it('says the answer in a status banner with the date', () => {
    setup();
    expect(screen.getByText("You're in for Tue 10 Nov.")).toBeInTheDocument();
    expect(screen.getByText("You're in for Tue 10 Nov.")).toHaveAttribute('role', 'status');
  });

  it('words the banner for Maybe and for Out', () => {
    const maybe = render(
      <MemberAnswer view={answered(ANA, 'maybe')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent("You're a maybe for Tue 10 Nov. You can change this any time.");
    maybe.unmount();
    render(<MemberAnswer view={answered(ANA, 'out')} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent("You're out for Tue 10 Nov.");
  });

  it('answers with a tap on each button', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(onAnswer).toHaveBeenLastCalledWith('maybe');
    await userEvent.click(screen.getByRole('button', { name: 'Out' }));
    expect(onAnswer).toHaveBeenLastCalledWith('out');
    await userEvent.click(screen.getByRole('button', { name: 'In' }));
    expect(onAnswer).toHaveBeenLastCalledWith('in', false);
    expect(onAnswer).toHaveBeenCalledTimes(3);
  });

  it('disables every answer while busy', () => {
    setup({ busy: true });
    for (const name of ['In', 'Maybe', 'Out', "I'll arrive late"]) expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('does not disable them when not busy', () => {
    setup();
    for (const name of ['In', 'Maybe', 'Out', "I'll arrive late"]) expect(screen.getByRole('button', { name })).toBeEnabled();
  });
});

describe('arriving late', () => {
  it('is not pressed when you are not late', () => {
    setup();
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is pressed when you are in and late', () => {
    setup({ view: answered(ANA, 'in', true) });
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is not pressed when late is kept on a maybe', () => {
    setup({ view: answered(ANA, 'maybe', true) });
    expect(screen.getByRole('button', { name: "I'll arrive late" })).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns late on while you are in', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });

  it('turns late off while you are in and late', async () => {
    const { onAnswer } = setup({ view: answered(ANA, 'in', true) });
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', false);
  });

  it('answers In with late when you were a maybe', async () => {
    const { onAnswer } = setup({ view: answered(ANA, 'maybe') });
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });

  it('answers In with late when you were out, or had not answered', async () => {
    const first = setup({ view: unanswered(ANA) });
    await userEvent.click(screen.getByRole('button', { name: "I'll arrive late" }));
    expect(first.onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });

  it('keeps late when you tap In again while late', async () => {
    const { onAnswer } = setup({ view: answered(ANA, 'in', true) });
    await userEvent.click(screen.getByRole('button', { name: 'In' }));
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith('in', true);
  });
});

describe('who is in', () => {
  it('lists the In people as circles with first names, in the list order', () => {
    setup();
    const section = screen.getByRole('region', { name: 'In' });
    const names = within(section)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(names.slice(0, 3)).toEqual(['ANAna', 'BCBen C.', 'CACarlo']);
    expect(names).toHaveLength(11);
  });

  it('shows the count', () => {
    setup();
    expect(within(screen.getByRole('region', { name: 'In' })).getByText('11 people')).toBeInTheDocument();
  });

  it('says 1 person for one', () => {
    const only = sample({ answers: [{ player_id: ANA, status: 'in', late: false }], friends: 0 });
    setup({ view: only });
    expect(screen.getByText('1 person')).toBeInTheDocument();
  });

  it('shows 12 circles at most, then how many more', () => {
    const many = sample({
      players: Array.from({ length: 15 }, (_, i) => ({ id: `q${i}`, first_name: `Name${String.fromCharCode(97 + i)}`, last_initial: null, has_photo: false, photo_seq: 0 })),
      answers: Array.from({ length: 15 }, (_, i) => ({ player_id: `q${i}`, status: 'in' as const, late: false })),
      friends: 0,
    });
    setup({ view: many, me: 'q0' });
    const items = within(screen.getByRole('region', { name: 'In' })).getAllByRole('listitem');
    expect(items).toHaveLength(13);
    expect(items[12]).toHaveTextContent('+3 more');
    expect(screen.getByText('15 people')).toBeInTheDocument();
  });

  it('shows exactly 12 with no more line', () => {
    const twelve = sample({
      players: Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, first_name: `Name${String.fromCharCode(97 + i)}`, last_initial: null, has_photo: false, photo_seq: 0 })),
      answers: Array.from({ length: 12 }, (_, i) => ({ player_id: `q${i}`, status: 'in' as const, late: false })),
      friends: 0,
    });
    setup({ view: twelve, me: 'q0' });
    expect(within(screen.getByRole('region', { name: 'In' })).getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('ignores an answer from someone who is not on the roster', () => {
    const view = sample({ answers: [...sample().answers, { player_id: 'gone', status: 'in', late: false }] });
    setup({ view });
    expect(screen.getByText('11 people')).toBeInTheDocument();
  });

  it('does not count a maybe from someone who is not on the roster', () => {
    const view = sample({ answers: [...sample().answers, { player_id: 'gone', status: 'maybe', late: false }] });
    setup({ view });
    expect(screen.getByText('3 maybe')).toBeInTheDocument();
  });

  it('shows no In list when nobody is in', () => {
    setup({ view: sample({ answers: [], friends: 0 }) });
    expect(screen.getByText('Nobody yet.')).toBeInTheDocument();
    expect(screen.queryByText(/people$/)).toBeNull();
  });

  it('shows the last initial for the two Bens', () => {
    setup({ view: answered('p14', 'in') });
    const section = screen.getByRole('region', { name: 'In' });
    expect(within(section).getByText('Ben C.')).toBeInTheDocument();
    expect(within(section).getByText('Ben D.')).toBeInTheDocument();
  });
});

describe('maybe, out and friends', () => {
  it('shows Maybe as a count and never as names', () => {
    setup();
    expect(screen.getByText('3 maybe')).toBeInTheDocument();
    for (const name of ['Mo', 'Ben D.']) expect(screen.queryByText(name)).toBeNull();
  });

  it('leaves the Maybe line out when there are none', () => {
    setup({ view: sample({ answers: sample().answers.filter((a) => a.status !== 'maybe') }) });
    expect(screen.queryByText(/maybe$/)).toBeNull();
  });

  it('never shows an Out count or an Out name', () => {
    setup();
    expect(screen.queryByText('Ned')).toBeNull();
    expect(screen.queryByText('Ola')).toBeNull();
    expect(screen.queryByText(/\b2 out\b/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Ned|Ola/);
  });

  it('shows no names for people who are not In, apart from you', () => {
    setup({ view: answered('p01', 'out') });
    // You are out, and still not in the In list.
    expect(within(screen.getByRole('region', { name: 'In' })).queryByText('Ana')).toBeNull();
  });

  it('shows friends as a count', () => {
    setup();
    expect(screen.getByText('Plus 1 friend')).toBeInTheDocument();
  });

  it('says friends for more than one, and nothing for none', () => {
    const two = render(
      <MemberAnswer view={sample({ friends: 2 })} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />,
    );
    expect(screen.getByText('Plus 2 friends')).toBeInTheDocument();
    two.unmount();
    render(<MemberAnswer view={sample({ friends: 0 })} me={ANA} busy={false} message={null} onAnswer={vi.fn()} onForget={vi.fn()} onAddFriend={vi.fn()} />);
    expect(screen.queryByText(/^Plus /)).toBeNull();
  });

  it('never shows the link code or a player id', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/p01|abc123/);
  });
});

describe('the busy line', () => {
  it('shows when more than 4 for each court are in, friends included', () => {
    // 11 in plus 2 friends is 13, and 3 courts is 12.
    setup({ view: sample({ friends: 2 }) });
    expect(screen.getByText('Busy night: 13 in for 3 courts. Expect to sit out a game now and then.')).toBeInTheDocument();
  });

  it('does not show at exactly 4 for each court', () => {
    setup({ view: sample({ friends: 1 }) });
    expect(screen.queryByText(/^Busy night/)).toBeNull();
  });

  it('does not show when the courts are not known', () => {
    setup({ view: sample({ courts: null, friends: 9 }) });
    expect(screen.queryByText(/^Busy night/)).toBeNull();
  });
});

describe('Bring a friend', () => {
  it('opens the friend sheet and sends the name', async () => {
    const { onAddFriend } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Bring a friend' }));
    expect(screen.getByRole('dialog', { name: 'Bring a friend' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Friend's name"), 'Rico');
    await userEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    expect(onAddFriend).toHaveBeenCalledExactlyOnceWith('Rico');
  });

  it('closes the sheet with Escape', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Bring a friend' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is disabled while busy', () => {
    setup({ busy: true });
    expect(screen.getByRole('button', { name: 'Bring a friend' })).toBeDisabled();
  });
});

describe('the message', () => {
  it('shows nothing when there is none', () => {
    setup();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failure as an alert', () => {
    setup({ message: { text: 'No connection. Try again when you are online.', ok: false } });
    expect(screen.getByRole('alert')).toHaveTextContent('No connection. Try again when you are online.');
  });

  it('shows a success as a status', () => {
    setup({ message: { text: 'Added for the organizer to confirm.', ok: true } });
    const el = screen.getByText('Added for the organizer to confirm.');
    expect(el).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Add to calendar', () => {
  it('downloads the calendar file for the view', async () => {
    const spy = vi.spyOn(download, 'downloadFile').mockImplementation(() => undefined);
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const [name, text] = spy.mock.calls[0];
    expect(name).toMatch(/\.ics$/);
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:Tuesday open play');
    expect(text).toContain('DTSTART:20261110T190000');
    expect(text).toContain('LOCATION:Sample Hall');
  });
});

describe('what is never shown', () => {
  it('has no exclamation marks and no em dashes', () => {
    setup();
    expect(document.body.textContent).not.toContain('!');
    expect(document.body.textContent).not.toContain(String.fromCharCode(0x2014));
  });
});
