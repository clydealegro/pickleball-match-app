import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLOTS, MAX_VENUE_LENGTH, MAX_VENUES, useSlotsStore } from './slots';

const state = () => useSlotsStore.getState();

beforeEach(() => {
  localStorage.clear();
  useSlotsStore.setState({
    slots: [
      { id: 'tue', weekday: 2, venue: 'Park' },
      { id: 'thu', weekday: 4, venue: 'Gym' },
      { id: 'sat', weekday: 6 },
    ],
    venues: ['Park', 'Gym', 'Hall'],
    tonight: {},
    persistent: true,
  });
});

describe('renameVenue', () => {
  it('renames the place in the list and on every day that uses it', () => {
    expect(state().renameVenue('Park', 'Park Courts')).toBe('Park Courts');
    expect(state().venues).toEqual(['Park Courts', 'Gym', 'Hall']);
    expect(state().slots.find((s) => s.id === 'tue')?.venue).toBe('Park Courts');
    expect(state().slots.find((s) => s.id === 'thu')?.venue).toBe('Gym');
  });

  it('renames a this-time-only venue too', () => {
    useSlotsStore.setState({ tonight: { sat: { venue: 'Park', startMin: 600 } } });
    state().renameVenue('Park', 'Park Courts');
    expect(state().tonight.sat).toEqual({ venue: 'Park Courts', startMin: 600 });
  });

  it('stores the change', () => {
    state().renameVenue('Hall', 'Town Hall');
    expect(JSON.parse(localStorage.getItem('pickleball.slots')!).venues).toEqual(['Park', 'Gym', 'Town Hall']);
  });

  it('trims the name and cuts it to the limit', () => {
    expect(state().renameVenue('Hall', `  ${'x'.repeat(MAX_VENUE_LENGTH + 10)}  `)).toBe('x'.repeat(MAX_VENUE_LENGTH));
  });

  it('refuses a blank name, a name another place has (ignoring capitals), and a place that is not saved', () => {
    expect(state().renameVenue('Hall', '   ')).toBe('');
    expect(state().renameVenue('Hall', 'gym')).toBe('');
    expect(state().renameVenue('Nowhere', 'Anything')).toBe('');
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
  });

  it('lets a place change only its capitals', () => {
    expect(state().renameVenue('Park', 'PARK')).toBe('PARK');
    expect(state().venues[0]).toBe('PARK');
  });

  it('returns the same name, and changes nothing, when the name is the same', () => {
    expect(state().renameVenue('Park', 'Park')).toBe('Park');
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
  });
});

describe('removeVenue and restoreVenue', () => {
  it('takes a place off the list but leaves the days that use it alone', () => {
    expect(state().removeVenue('Gym')).toBe(1);
    expect(state().venues).toEqual(['Park', 'Hall']);
    expect(state().slots.find((s) => s.id === 'thu')?.venue).toBe('Gym');
  });

  it('says -1 for a place that is not saved', () => {
    expect(state().removeVenue('Nowhere')).toBe(-1);
  });

  it('puts a removed place back where it was', () => {
    const at = state().removeVenue('Gym');
    state().restoreVenue('Gym', at);
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
  });

  it('does not add a place twice, or past the limit', () => {
    state().restoreVenue('Park', 0);
    expect(state().venues).toEqual(['Park', 'Gym', 'Hall']);
    useSlotsStore.setState({ venues: Array.from({ length: MAX_VENUES }, (_, i) => `V${i}`) });
    state().restoreVenue('Extra', 0);
    expect(state().venues).toHaveLength(MAX_VENUES);
  });

  it('stores both changes', () => {
    const at = state().removeVenue('Park');
    expect(JSON.parse(localStorage.getItem('pickleball.slots')!).venues).toEqual(['Gym', 'Hall']);
    state().restoreVenue('Park', at);
    expect(JSON.parse(localStorage.getItem('pickleball.slots')!).venues).toEqual(['Park', 'Gym', 'Hall']);
  });
});

describe('the defaults', () => {
  it('start with no saved places', () => {
    expect(DEFAULT_SLOTS.venues).toEqual([]);
  });
});
