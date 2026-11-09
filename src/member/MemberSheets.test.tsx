import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActionResult } from './useMemberPage';
import { FriendSheet, JoinSheet } from './MemberSheets';

const OK: ActionResult = { ok: true, message: 'Added for the organizer to confirm.' };
const user = () => userEvent.setup({ delay: null });

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Fake timers do not mix with Testing Library's waiting, so the close timer is read from a spy and run by hand.
function closeTimer(spy: MockInstance<typeof setTimeout>) {
  const at = spy.mock.calls.findIndex((c) => c[1] === 1500);
  return at < 0 ? null : { run: spy.mock.calls[at][0] as () => void, id: spy.mock.results[at].value };
}

describe('the two sheets', () => {
  it('opens Bring a friend as a dialog with a name field, 16 px type and a 40 character limit', () => {
    render(<FriendSheet onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Bring a friend' })).toBeInTheDocument();
    const field = screen.getByLabelText("Friend's name");
    expect(field).toHaveAttribute('maxlength', '40');
    expect(field).toHaveClass('member-input');
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeEnabled();
  });

  it('opens Ask to join as a dialog with its own label and button', () => {
    render(<JoinSheet onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Ask to join' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveAttribute('maxlength', '40');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('sends the trimmed name', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<FriendSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText("Friend's name"), '  Rico  ');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Rico');
  });

  it('sends with Enter too', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika{Enter}');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Mika');
  });

  it('does not send an empty name and says why', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Use 1 to 40 characters.');
  });

  it('does not send a name of only spaces', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText('Your name'), '   ');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows a success as a status, then closes after a moment', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const onClose = vi.fn();
    render(<FriendSheet onSubmit={async () => OK} onClose={onClose} />);
    await user().type(screen.getByLabelText("Friend's name"), 'Rico');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    expect(screen.getByRole('status')).toHaveTextContent('Added for the organizer to confirm.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    const timer = closeTimer(spy);
    expect(timer).not.toBeNull();
    act(() => timer!.run());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close after a success when the sheet is gone first', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<FriendSheet onSubmit={async () => OK} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText("Friend's name"), 'Rico');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    const timer = closeTimer(spy);
    expect(timer).not.toBeNull();
    unmount();
    expect(clear).toHaveBeenCalledWith(timer!.id);
  });

  it('shows a failure as an alert and stays open for another try', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const onClose = vi.fn();
    const failed: ActionResult = { ok: false, reason: 'too_many', message: 'The list of new names is full. Ask your organizer.' };
    render(<JoinSheet onSubmit={async () => failed} onClose={onClose} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The list of new names is full. Ask your organizer.');
    expect(closeTimer(spy)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.getByLabelText('Your name')).toHaveValue('Mika');
  });

  it('closes at once when a failure has no words, because the page shows the reason itself', async () => {
    const onClose = vi.fn();
    render(<JoinSheet onSubmit={async () => ({ ok: false, reason: 'cancelled', message: '' })} onClose={onClose} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is disabled while the request runs, and sends once', async () => {
    let finish!: (r: ActionResult) => void;
    const onSubmit = vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve)));
    render(<JoinSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText('Your name'), 'Mika');
    await user().click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByLabelText('Your name')).toBeDisabled();
    await user().keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, reason: 'server', message: 'Something went wrong. Try again.' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('stays disabled after a success, so a name is not sent twice', async () => {
    const onSubmit = vi.fn(async () => OK);
    render(<FriendSheet onSubmit={onSubmit} onClose={vi.fn()} />);
    await user().type(screen.getByLabelText("Friend's name"), 'Rico');
    await user().click(screen.getByRole('button', { name: 'Add friend' }));
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeDisabled();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<FriendSheet onSubmit={vi.fn()} onClose={onClose} />);
    await user().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the Close button', async () => {
    const onClose = vi.fn();
    render(<JoinSheet onSubmit={vi.fn()} onClose={onClose} />);
    await user().click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
