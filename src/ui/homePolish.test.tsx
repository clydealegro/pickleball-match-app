import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../store/historyStore';
import { useRosterStore } from '../store/rosterStore';
import { DEFAULT_SLOTS, useSlotsStore } from '../store/slots';
import { HomeScreen } from './HomeScreen';

// Saturday 7 Nov 2026, noon.
const NOW = new Date(2026, 10, 7, 12).getTime();

beforeEach(() => {
  localStorage.clear();
  useSlotsStore.setState({ slots: DEFAULT_SLOTS.slots.map((s) => ({ ...s })), venues: [], tonight: {}, persistent: true });
  useHistoryStore.setState({ entries: [], loaded: true, persistent: true });
  useRosterStore.setState({ players: [], loaded: true });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const show = () => render(<HomeScreen onStart={() => {}} onResume={() => {}} onHistory={() => {}} onViewSummary={() => {}} />);
const note = () => screen.queryByText('This time only');

describe('the This time only caption', () => {
  it('is not there when nothing was changed for this time', () => {
    show();
    expect(note()).not.toBeInTheDocument();
  });

  it('is not there for an empty this-time entry', () => {
    useSlotsStore.setState({ tonight: { sat: {} } });
    show();
    expect(note()).not.toBeInTheDocument();
  });

  it('shows under the lines when the shown slot has a this-time override', () => {
    useSlotsStore.setState({ slots: [{ id: 'sat', weekday: 6, startMin: 1140, venue: 'Hall A' }], tonight: { sat: { venue: 'Park' } } });
    show();
    expect(note()).toBeInTheDocument();
    const body = document.querySelector('.home-hero-body')!;
    expect(body).toContainElement(note());
    expect(body.textContent!.indexOf('Park')).toBeLessThan(body.textContent!.indexOf('This time only'));
  });

  it('shows for an override that clears a value, such as no end time', () => {
    useSlotsStore.setState({ slots: [{ id: 'sat', weekday: 6, startMin: 1140, endMin: 1260 }], tonight: { sat: { endMin: undefined } } });
    show();
    expect(note()).toBeInTheDocument();
  });

  it('follows the chip: another slot without an override shows none', async () => {
    useSlotsStore.setState({ tonight: { sat: { venue: 'Park' } } });
    show();
    expect(note()).toBeInTheDocument();
    screen.getByRole('radio', { name: 'Tue 10' }).click();
    expect(await screen.findByRole('heading', { level: 1, name: 'Tuesday' })).toBeInTheDocument();
    expect(note()).not.toBeInTheDocument();
  });
});

describe('the hero is laid out top and bottom', () => {
  it('puts the pill, the pencil and the weekday in the top block', () => {
    show();
    const head = document.querySelector<HTMLElement>('.home-hero-head')!;
    expect(head).toBeInTheDocument();
    expect(head.querySelector('.home-pill')).not.toBeNull();
    expect(within(head).getByRole('button', { name: 'Edit Saturday' })).toBeInTheDocument();
    expect(within(head).getByRole('heading', { level: 1, name: 'Saturday' })).toBeInTheDocument();
  });

  it('puts the time, the venue line and the regulars in the bottom block, with the dashed chips', () => {
    useSlotsStore.setState({ slots: [{ id: 'sat', weekday: 6 }] });
    show();
    const body = document.querySelector<HTMLElement>('.home-hero-body')!;
    expect(within(body).getByRole('button', { name: '+ Add a time' })).toBeInTheDocument();
    expect(within(body).getByRole('button', { name: '+ Add a venue' })).toBeInTheDocument();
    expect(within(body).getByRole('button', { name: '+ Add courts' })).toBeInTheDocument();
    expect(body.querySelector('.home-foot')).not.toBeNull();
    expect(document.querySelector('.home-hero-head')!.nextElementSibling).toBe(body);
    expect(document.querySelector('.home-hero')).toHaveClass('home-hero-split');
  });
});
