import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRosterDbForTests } from '../store/rosterDb';
import { useRosterStore } from '../store/rosterStore';
import { useSessionStore } from '../store/sessionStore';
import App from './App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  localStorage.clear();
  useSessionStore.setState({ session: null, undoStack: [], saveFailed: false, lastAction: null });
  await resetRosterDbForTests();
  useRosterStore.setState({ players: [], loaded: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `P${String.fromCharCode(65 + i)}`).join('{enter}');

async function startSession(user: User, count: number) {
  render(<App />);
  await user.type(screen.getByLabelText('Search or add players'), names(count));
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('button', { name: `Start ${count} players` }));
}
const handle = () => screen.getByRole('button', { name: /^Waiting/ });
const top = () => document.querySelector<HTMLElement>('.sheet-top')!;

function drag(x1: number, y1: number, x2: number, y2: number) {
  fireEvent.touchStart(top(), { touches: [{ clientX: x1, clientY: y1 }] });
  fireEvent.touchEnd(top(), { changedTouches: [{ clientX: x2, clientY: y2 }] });
}

describe('the top of the Waiting sheet', () => {
  it('has no arrow, only the grip, and one icon-free tap target for opening', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(document.querySelector('.sheet-chevron')).toBeNull();
    expect(top().querySelector('.sheet-grip')).not.toBeNull();
    expect(within(handle()).queryByRole('img')).toBeNull();
  });

  it('puts the grip in the middle of the whole sheet, not inside the title button', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const grip = top().querySelector('.sheet-grip')!;
    expect(grip.parentElement).toBe(top());
    expect(handle().contains(grip)).toBe(false);
    expect(top().firstElementChild).toBe(grip);
  });

  it('opens and closes from a tap anywhere on the top: title, label, faces or the empty space', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(top().querySelector('.next-label')!);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(top().querySelector('.peek')!);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(top().querySelector('.peek-row')!);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    await user.click(handle());
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes once per tap from the keyboard too', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    handle().focus();
    await user.keyboard('{Enter}');
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('has a labelled Add player button that opens the sheet to add, and does not toggle the Waiting sheet', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    const add = screen.getByRole('button', { name: 'Add player' });
    expect(add).toHaveTextContent('Add player');
    await user.click(add);
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('has just the one Add player button, with none lower down the open list', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    await user.click(handle());
    expect(screen.getAllByRole('button', { name: /add player/i })).toHaveLength(1);
  });
});

describe('what the label and the faces say', () => {
  it('says Next in line when four or more are waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    expect(screen.getByText('Next in line')).toBeInTheDocument();
  });

  it('says how many more a game needs when fewer than four are waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 9);
    expect(screen.getByText('Need 3 more waiting to fill the next game')).toBeInTheDocument();
    expect(screen.queryByText('Next in line')).not.toBeInTheDocument();
  });

  it('shows how many more are waiting beyond the four faces, and not when there are no more', async () => {
    const user = userEvent.setup();
    await startSession(user, 14);
    expect(top().querySelectorAll('.peek li')).toHaveLength(4);
    expect(within(top()).getByText('+2 more')).toBeInTheDocument();
  });

  it('shows no +more chip when the faces are everyone waiting', async () => {
    const user = userEvent.setup();
    await startSession(user, 12);
    expect(top().querySelector('.peek-more')).toBeNull();
  });
});

describe('swiping the top of the Waiting sheet', () => {
  it('opens it on a swipe up and closes it on a swipe down', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    drag(180, 700, 185, 600);
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
    drag(180, 600, 175, 700);
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('does nothing more when it is already open or closed in that direction', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    drag(180, 600, 180, 700); // down while closed
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
    drag(180, 700, 180, 600);
    drag(180, 700, 180, 600); // up again while open
    expect(handle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('ignores a short drag, a sideways drag, a slow drag and a second finger', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    drag(180, 700, 180, 680); // too short
    drag(100, 700, 300, 660); // mostly sideways
    expect(handle()).toHaveAttribute('aria-expanded', 'false');

    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    fireEvent.touchStart(top(), { touches: [{ clientX: 180, clientY: 700 }] });
    now.mockReturnValue(2_000);
    fireEvent.touchEnd(top(), { changedTouches: [{ clientX: 180, clientY: 600 }] });
    expect(handle()).toHaveAttribute('aria-expanded', 'false');

    now.mockRestore();
    fireEvent.touchStart(top(), {
      touches: [
        { clientX: 180, clientY: 700 },
        { clientX: 200, clientY: 700 },
      ],
    });
    fireEvent.touchEnd(top(), { changedTouches: [{ clientX: 180, clientY: 600 }] });
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('forgets a drag that was cancelled', async () => {
    const user = userEvent.setup();
    await startSession(user, 5);
    fireEvent.touchStart(top(), { touches: [{ clientX: 180, clientY: 700 }] });
    fireEvent.touchCancel(top());
    fireEvent.touchEnd(top(), { changedTouches: [{ clientX: 180, clientY: 600 }] });
    expect(handle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('on a wide screen', () => {
  it('is a plain panel with the title and the Add player button, and no handle', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const user = userEvent.setup();
    await startSession(user, 5);
    expect(screen.queryByRole('button', { name: /^Waiting/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting (1)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add player' }));
    expect(await screen.findByRole('dialog', { name: 'Add player' })).toBeInTheDocument();
  });
});

describe('the preview row of the Waiting sheet', () => {
  // jsdom does not load the stylesheet, so the rule that hides the row when the sheet is open is checked by eye. What a
  // test can pin is that the label stays outside the row and the faces and the "+N more" chip are both inside it, so
  // hiding the row hides them together.
  it('keeps the faces and the +N more chip together in one row', async () => {
    const user = userEvent.setup();
    await startSession(user, 14);
    expect(top().querySelector('.peek-row .peek-more')).not.toBeNull();
    expect(top().querySelector('.peek-row .peek')).not.toBeNull();
    expect(top().querySelector('.peek-row .next-label')).toBeNull();
  });
});
