import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResultSheet } from './ResultSheet';

function setup(playTo = 11) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<ResultSheet courtNumber={2} team1={['Ann', 'Ben']} team2={['Cy', 'Dee']} playTo={playTo} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose, user: userEvent.setup() };
}
const chips = () => within(screen.getByRole('group', { name: 'Their score' })).getAllByRole('button');
const winning = () => screen.getByRole('group', { name: 'Winning score' }).querySelector('output')!.textContent;

describe('ResultSheet, who won', () => {
  it('asks who won on a named court, with one big button per team showing the names', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Court 2: who won?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ann and Ben' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cy and Dee' })).toBeInTheDocument();
  });

  it('skips the result with one tap, saving nothing', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Skip result' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith();
  });

  it('closes without saving from the close button and from Escape', async () => {
    const { user, onClose, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('ResultSheet, the score', () => {
  it('moves to the score after a winner is chosen, and names the winners', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    expect(screen.getByRole('dialog', { name: 'Court 2: score' })).toBeInTheDocument();
    expect(screen.getByText('Cy and Dee won')).toBeInTheDocument();
  });

  it('starts the winning score at the target, and a tap on a losing score saves it in team order', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    expect(winning()).toBe('11');
    await user.click(screen.getByRole('button', { name: '7' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 1, score: [11, 7] });
  });

  it('puts team 2’s points second when team 1 wins and first when team 2 wins', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    await user.click(screen.getByRole('button', { name: '4' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 2, score: [4, 11] });
  });

  it.each([
    [11, 0, 10],
    [15, 0, 14],
    [21, 0, 20],
  ])('with play to %i offers losing scores %i to %i', async (playTo, low, high) => {
    const { user } = setup(playTo);
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    expect(winning()).toBe(String(playTo));
    expect(chips().map((c) => c.textContent)).toEqual(Array.from({ length: high - low + 1 }, (_, i) => String(low + i)));
  });

  it('lets the winning score go up for a win past the target, and offers losing scores to match', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    await user.click(screen.getByRole('button', { name: 'Raise the winning score' }));
    await user.click(screen.getByRole('button', { name: 'Raise the winning score' }));
    expect(winning()).toBe('13');
    expect(chips().at(-1)!.textContent).toBe('12');
    await user.click(screen.getByRole('button', { name: '11' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 1, score: [13, 11] });
  });

  it('turns off losing scores that are not below the winning score, when it is lowered', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Lower the winning score' }));
    expect(winning()).toBe('7');
    expect(screen.getByRole('button', { name: '6' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '7' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '10' })).toBeDisabled();
  });

  it('will not go below a winning score of 1 or above 99', async () => {
    const { user } = setup(11);
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    const lower = screen.getByRole('button', { name: 'Lower the winning score' });
    for (let i = 0; i < 12; i++) await user.click(lower);
    expect(winning()).toBe('1');
    expect(lower).toBeDisabled();
  });

  it('skips only the score, keeping the winner', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    await user.click(screen.getByRole('button', { name: 'Skip score' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 2 });
  });

  it('goes back to choose the winner again, and keeps the winning score set so far', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: 'Ann and Ben' }));
    await user.click(screen.getByRole('button', { name: 'Raise the winning score' }));
    await user.click(screen.getByRole('button', { name: 'Change winner' }));
    expect(screen.getByRole('dialog', { name: 'Court 2: who won?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cy and Dee' }));
    expect(winning()).toBe('12');
    await user.click(screen.getByRole('button', { name: '3' }));
    expect(onSave).toHaveBeenCalledWith({ winner: 2, score: [3, 12] });
  });
});
