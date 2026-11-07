import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('shows its text as a status message with an Undo button that works', async () => {
    const onUndo = vi.fn();
    render(<Toast id={1} text="Court 1: Ann and Ben vs Cy and Dee" onUndo={onUndo} onDismiss={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Court 1: Ann and Ben vs Cy and Dee');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('goes away by itself after eight seconds, and not before', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast id={1} text="x" onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(7_999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('starts the wait again when a new message replaces it', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast id={1} text="one" onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(6_000));
    rerender(<Toast id={2} text="two" onUndo={() => {}} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(6_000));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
