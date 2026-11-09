import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { sample } from './fixtures';
import { MemberCancelled } from './MemberCancelled';

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
  delete document.documentElement.dataset.theme;
});

const cancelled = (reason: string | null, playDate = '2026-11-10') => sample({ cancelled: { reason }, play_date: playDate });

describe('MemberCancelled', () => {
  it('says no play this weekday, using the date', () => {
    render(<MemberCancelled view={cancelled(null)} />);
    expect(screen.getByRole('heading', { name: 'No play this Tuesday' })).toBeInTheDocument();
  });

  it('uses the weekday of the date and not the weekday on the link', () => {
    render(<MemberCancelled view={{ ...cancelled(null, '2026-11-12'), weekday: 2 }} />);
    expect(screen.getByRole('heading', { name: 'No play this Thursday' })).toBeInTheDocument();
  });

  it('shows the date', () => {
    render(<MemberCancelled view={cancelled(null)} />);
    expect(screen.getByText('Tue 10 Nov')).toBeInTheDocument();
  });

  it('shows the reason in a notice when there is one', () => {
    render(<MemberCancelled view={cancelled('Venue is closed for floor repairs.')} />);
    expect(screen.getByText('Venue is closed for floor repairs.')).toHaveClass('member-notice');
  });

  it('shows no notice when there is no reason, or only spaces', () => {
    const { container, rerender } = render(<MemberCancelled view={cancelled(null)} />);
    expect(container.querySelector('.member-notice')).toBeNull();
    rerender(<MemberCancelled view={cancelled('   ')} />);
    expect(container.querySelector('.member-notice')).toBeNull();
  });

  it('shows the next session a week later', () => {
    render(<MemberCancelled view={cancelled(null)} />);
    expect(screen.getByText('Next session: Tue 17 Nov')).toBeInTheDocument();
  });

  it('carries the next session over a month and a year end', () => {
    render(<MemberCancelled view={cancelled(null, '2026-12-29')} />);
    expect(screen.getByText('Next session: Tue 5 Jan')).toBeInTheDocument();
  });

  it('has no answer buttons, no roster and no counts', () => {
    render(<MemberCancelled view={cancelled('Rain')} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Ana|maybe|people/);
  });
});
