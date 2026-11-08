import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, MAX_VENUES, useSlotsStore, type Slot } from '../store/slots';
import { EditSlotSheet } from './EditSlotSheet';

const tue: Slot = { id: 'tue', weekday: 2 };

beforeEach(() => {
  localStorage.clear();
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
});

function setup(over: Partial<Slot> = {}, venues: string[] = ['Hall A', 'Hall B']) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  useSlotsStore.setState({ venues });
  const user = userEvent.setup();
  const effective = { ...tue, ...over };
  render(<EditSlotSheet slot={tue} effective={effective} venues={venues} onSave={onSave} onClose={onClose} />);
  return { user, onSave, onClose };
}

const start = () => screen.getByLabelText('Start time') as HTMLInputElement;
const end = () => screen.getByLabelText('End time') as HTMLInputElement;
const chip = (name: string) => screen.queryByRole('button', { name });

describe('EditSlotSheet', () => {
  it('names the weekday in the title', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Tuesday: when and where' })).toBeInTheDocument();
  });

  it('fills the time inputs from the effective slot', () => {
    setup({ startMin: 19 * 60, endMin: 21 * 60 + 30 });
    expect(start().value).toBe('19:00');
    expect(end().value).toBe('21:30');
  });

  it('leaves the time inputs empty when no time is set', () => {
    setup();
    expect(start().value).toBe('');
    expect(end().value).toBe('');
  });

  it('picks one venue at a time and clears it when tapped again', async () => {
    const { user } = setup({ venue: 'Hall A' });
    expect(chip('Hall A')).toHaveAttribute('aria-pressed', 'true');
    expect(chip('Hall B')).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip('Hall B')!);
    expect(chip('Hall A')).toHaveAttribute('aria-pressed', 'false');
    expect(chip('Hall B')).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip('Hall B')!);
    expect(chip('Hall B')).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a new venue, selects it and shows it as a chip', async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText('New venue'), 'Court Club');
    await user.click(screen.getByRole('button', { name: 'Add venue' }));
    expect(chip('Court Club')).toHaveAttribute('aria-pressed', 'true');
    expect(useSlotsStore.getState().venues).toContain('Court Club');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ startMin: undefined, endMin: undefined, venue: 'Court Club' }, 'this-time');
  });

  it('adds a venue with Enter', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('New venue'), 'Park{enter}');
    expect(chip('Park')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores an empty venue name', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add venue' }));
    expect(useSlotsStore.getState().venues).toEqual(['Hall A', 'Hall B']);
  });

  it('does not select or show a 13th venue, and keeps the choice it had', async () => {
    const full = Array.from({ length: MAX_VENUES }, (_, i) => `Venue ${i + 1}`);
    const { user } = setup({ venue: 'Venue 2' }, full);
    await user.type(screen.getByLabelText('New venue'), 'One too many');
    await user.click(screen.getByRole('button', { name: 'Add venue' }));
    expect(chip('One too many')).toBeNull();
    expect(chip('Venue 2')).toHaveAttribute('aria-pressed', 'true');
    expect(useSlotsStore.getState().venues).toHaveLength(MAX_VENUES);
  });

  it('defaults the scope to just this time', () => {
    setup();
    expect(screen.getByRole('radio', { name: 'Just this time' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Always for Tuesday' })).not.toBeChecked();
  });

  it('saves for this time with the chosen times and venue', async () => {
    const { user, onSave } = setup({ venue: 'Hall A' });
    await user.type(start(), '19:00');
    await user.type(end(), '21:00');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ startMin: 1140, endMin: 1260, venue: 'Hall A' }, 'this-time');
  });

  it('saves for always when that scope is chosen', async () => {
    const { user, onSave } = setup({ startMin: 600 });
    await user.click(screen.getByRole('radio', { name: 'Always for Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ startMin: 600, endMin: undefined, venue: undefined }, 'always');
  });

  it('saves cleared times as undefined', async () => {
    const { user, onSave } = setup({ startMin: 1140, endMin: 1260 });
    await user.clear(start());
    await user.clear(end());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ startMin: undefined, endMin: undefined, venue: undefined }, 'this-time');
  });

  it('rejects an end that is not after the start', async () => {
    const { user, onSave } = setup({ startMin: 1260, endMin: 1140 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('End time must be after the start.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('rejects an end equal to the start', async () => {
    const { user, onSave } = setup({ startMin: 1140, endMin: 1140 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('allows an end with no start', async () => {
    const { user, onSave } = setup({ endMin: 1140 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and from Escape', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
