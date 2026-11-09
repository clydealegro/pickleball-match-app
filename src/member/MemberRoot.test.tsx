import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// None of these may run on the member page. A call to any of them fails the test below.
const spies = vi.hoisted(() => ({ coordinator: vi.fn(() => () => undefined), attendance: vi.fn(() => () => undefined), init: vi.fn() }));
vi.mock('../sync/coordinator', () => ({ startSyncCoordinator: spies.coordinator }));
vi.mock('../sync/attendance/start', () => ({ startAttendanceSync: spies.attendance }));
vi.mock('../sync/auth', () => ({ useAuthStore: Object.assign(() => ({}), { getState: () => ({ init: spies.init }) }) }));

import { memoryRemote, sample } from './fixtures';
import { MemberRoot } from './MemberRoot';

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
  vi.clearAllMocks();
});

describe('MemberRoot', () => {
  it('opens the page with an injected remote', async () => {
    render(<MemberRoot code="abc123" remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { name: 'Who are you?' })).toBeInTheDocument();
  });

  it('says the link cannot be opened when the remote is null', () => {
    render(<MemberRoot code="abc123" remote={null} />);
    expect(screen.getByText('This link cannot be opened in this build.')).toBeInTheDocument();
  });

  it('has no backend in this build by default, so it says the same', () => {
    render(<MemberRoot code="abc123" />);
    expect(screen.getByText('This link cannot be opened in this build.')).toBeInTheDocument();
  });

  it('starts no sync, no attendance sync and no sign-in', async () => {
    render(<MemberRoot code="abc123" remote={memoryRemote()} />);
    await screen.findByRole('heading', { name: 'Who are you?' });
    expect(spies.coordinator).not.toHaveBeenCalled();
    expect(spies.attendance).not.toHaveBeenCalled();
    expect(spies.init).not.toHaveBeenCalled();
  });

  it('shows plain words and a Reload button when the page breaks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A reason that is not text breaks the cancelled screen while it draws.
    const broken = memoryRemote(sample({ cancelled: { reason: 5 as never } }));
    render(<MemberRoot code="abc123" remote={broken} />);
    expect(await screen.findByText('Something went wrong opening this page.')).toBeInTheDocument();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
