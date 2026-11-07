import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRating } from '../store/ratings';
import { useRosterStore } from '../store/rosterStore';
import { RatingsSection } from './RatingsSection';

const player = (id: string, name: string) => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 0 });

beforeEach(() => {
  localStorage.clear();
  useRosterStore.setState({ players: [player('p1', 'Ann'), player('p2', 'Ben')], loaded: true });
});
afterEach(() => {
  cleanup();
});

describe('Skill ratings section', () => {
  it('lists saved players as not rated at first', () => {
    render(<RatingsSection />);
    expect(screen.getByLabelText('Ann')).toHaveAttribute('aria-valuetext', 'Not rated, counts as 5');
    expect(screen.getByRole('button', { name: 'Clear rating for Ann' })).toBeDisabled();
  });

  it('saves a rating on this device when the slider moves', () => {
    render(<RatingsSection />);
    fireEvent.change(screen.getByLabelText('Ann'), { target: { value: '8' } });
    expect(getRating('p1')).toBe(8);
    expect(getRating('p2')).toBeUndefined();
    expect(screen.getByLabelText('Ann')).toHaveAttribute('aria-valuetext', '8');
  });

  it('clears a rating', async () => {
    render(<RatingsSection />);
    fireEvent.change(screen.getByLabelText('Ben'), { target: { value: '3' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear rating for Ben' }));
    expect(getRating('p2')).toBeUndefined();
  });

  it('asks for saved players first when there are none', () => {
    useRosterStore.setState({ players: [] });
    render(<RatingsSection />);
    expect(screen.getByText(/add saved players first/i)).toBeInTheDocument();
  });
});
