import type { SlotsData } from './slots';

/** Three weekly days with no time and no venue. Tests use it where a day should start empty. */
export const BLANK_SLOTS: SlotsData = {
  slots: [
    { id: 'tue', weekday: 2 },
    { id: 'thu', weekday: 4 },
    { id: 'sat', weekday: 6 },
  ],
  venues: [],
};
