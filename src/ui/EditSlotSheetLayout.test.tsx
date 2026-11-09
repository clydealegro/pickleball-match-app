import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlotsStore, type Slot } from '../store/slots';
import { EditSlotSheet } from './EditSlotSheet';
import { BLANK_SLOTS } from '../store/slotsFixture';

const tue: Slot = { id: 'tue', weekday: 2 };

beforeEach(() => {
  localStorage.clear();
  useSlotsStore.setState({ slots: BLANK_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {} });
});

function setup(over: Partial<Slot> = {}, venues: string[] = ['Hall A', 'Hall B']) {
  useSlotsStore.setState({ venues });
  const user = userEvent.setup();
  render(<EditSlotSheet slot={tue} effective={{ ...tue, ...over }} venues={venues} onSave={vi.fn()} onClose={vi.fn()} />);
  return { user, dialog: within(screen.getByRole('dialog')) };
}

describe('the slot sheet layout', () => {
  it('groups the form into When and Where, with Courts as its own row', () => {
    const { dialog } = setup();
    const when = within(dialog.getByRole('group', { name: 'When' }));
    expect(when.getByLabelText('Start time')).toBeInTheDocument();
    expect(when.getByLabelText('End time')).toBeInTheDocument();
    const where = within(dialog.getByRole('group', { name: 'Where' }));
    expect(where.getByRole('button', { name: 'Hall A' })).toBeInTheDocument();
    expect(where.getByLabelText('New venue')).toBeInTheDocument();
    expect(dialog.getByRole('group', { name: 'Courts' })).toBeInTheDocument();
  });

  it('labels the times Starts and Ends', () => {
    const { dialog } = setup();
    expect(dialog.getByText('Starts')).toBeInTheDocument();
    expect(dialog.getByText('Ends')).toBeInTheDocument();
  });

  it('adds a venue with one small button inside the field, not a second line of text', () => {
    const { dialog } = setup();
    expect(dialog.getByRole('button', { name: 'Add venue' })).toBeInTheDocument();
    expect(dialog.queryByText('Add venue')).not.toBeInTheDocument();
    expect(dialog.getByLabelText('New venue')).toHaveAttribute('placeholder', 'Add a venue');
  });

  it('Save is the only filled button', () => {
    const { dialog } = setup();
    const filled = dialog.getAllByRole('button').filter((b) => b.classList.contains('btn-primary'));
    expect(filled.map((b) => b.textContent)).toEqual(['Save']);
  });

  it('puts the this-time or always choice just above Save', () => {
    const { dialog } = setup();
    const choice = dialog.getByRole('radiogroup', { name: 'Apply to' });
    const save = dialog.getByRole('button', { name: 'Save' });
    expect(choice.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(choice.nextElementSibling === save || choice.parentElement?.nextElementSibling === save || save.previousElementSibling === choice).toBe(true);
  });

  it('says what Not set courts means, and drops that once courts are set', async () => {
    const { user, dialog } = setup();
    expect(dialog.getByText('You choose when you start.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'More courts' }));
    expect(dialog.queryByText('You choose when you start.')).not.toBeInTheDocument();
  });
});
