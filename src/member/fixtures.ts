import type { AttendanceViewData } from '../sync/attendance/types';
import type { MemberRemote } from './remote';

// Sample data for the member page tests and the browser check. Not used by the app.
type Row = [id: string, first: string, initial: string | null, answer: 'in' | 'maybe' | 'out' | null];

// Two players are called Ben. 11 are in, 3 maybe, 2 out.
const ROWS: Row[] = [
  ['p01', 'Ana', null, 'in'],
  ['p02', 'Ben', 'C', 'in'],
  ['p03', 'Carlo', null, 'in'],
  ['p04', 'Dee', null, 'in'],
  ['p05', 'Eli', null, 'in'],
  ['p06', 'Fay', null, 'in'],
  ['p07', 'Gus', null, 'in'],
  ['p08', 'Hera', null, 'in'],
  ['p09', 'Ian', null, 'in'],
  ['p10', 'Jun', null, 'in'],
  ['p11', 'Kai', null, 'in'],
  ['p12', 'Lia', null, 'maybe'],
  ['p13', 'Mo', null, 'maybe'],
  ['p14', 'Ben', 'D', 'maybe'],
  ['p15', 'Ned', null, 'out'],
  ['p16', 'Ola', null, 'out'],
];

export const SAMPLE: AttendanceViewData = {
  title: 'Tuesday open play',
  weekday: 2,
  venue: 'Sample Hall',
  start_min: 1140,
  end_min: 1260,
  courts: 3,
  play_date: '2026-11-10',
  cancelled: null,
  players: ROWS.map(([id, first_name, last_initial]) => ({ id, first_name, last_initial, has_photo: false, photo_seq: 0 })),
  answers: ROWS.flatMap(([id, , , answer]) => (answer ? [{ player_id: id, status: answer, late: false }] : [])),
  friends: 1,
};

export const sample = (patch: Partial<AttendanceViewData> = {}): AttendanceViewData => ({ ...SAMPLE, ...patch });

/** A remote that keeps the answers in memory, so the whole page can be driven without a server. */
export function memoryRemote(start: AttendanceViewData = SAMPLE): MemberRemote & { data: AttendanceViewData } {
  const remote = {
    data: start,
    async view() {
      return remote.data;
    },
    async answer(_code: string, playerId: string, status: 'in' | 'maybe' | 'out', late: boolean) {
      remote.data = {
        ...remote.data,
        answers: [...remote.data.answers.filter((a) => a.player_id !== playerId), { player_id: playerId, status, late: status === 'in' && late }],
      };
    },
    async addGuest(_code: string, _name: string, broughtBy: string | null) {
      if (broughtBy) remote.data = { ...remote.data, friends: remote.data.friends + 1 };
    },
  };
  return remote;
}
