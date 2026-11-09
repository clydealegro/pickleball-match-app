import { describe, expect, it } from 'vitest';
import { asBoard, asFaces, asLiveReply } from './liveTypes';

const BOARD = {
  title: 'Tuesday open play',
  venue: 'Nitro',
  startMin: 960,
  endMin: 1140,
  courts: [{ n: 1, status: 'playing', closing: false, startedAt: 5, teams: [['a', 'b'], ['c', 'd']] }, { n: 2, status: 'empty', closing: true }],
  players: { a: { f: 'Ana', l: 'R', r: 'r-a' }, b: { f: 'Ben', l: null, r: null }, c: { f: 'Cy', l: null, r: null }, d: { f: 'Dee', l: 'S', r: null } },
  waiting: ['e'],
  onBreak: [],
  next: { court: 1, ids: ['e'] },
  avgGameMs: 600000,
};

describe('asBoard', () => {
  it('keeps a good board whole', () => {
    expect(asBoard(BOARD)).toEqual(BOARD);
  });

  it('drops fields the page does not read, such as a smuggled rating', () => {
    const got = asBoard({ ...BOARD, secret: 1, players: { ...BOARD.players, a: { ...BOARD.players.a, rating: 9 } } });
    expect(JSON.stringify(got)).not.toContain('rating');
    expect(JSON.stringify(got)).not.toContain('secret');
  });

  it.each([
    ['not an object', 5],
    ['no title', { ...BOARD, title: undefined }],
    ['a long title', { ...BOARD, title: 'x'.repeat(81) }],
    ['courts that are not a list', { ...BOARD, courts: 'x' }],
    ['a court with a bad status', { ...BOARD, courts: [{ n: 1, status: 'broken', closing: false }] }],
    ['a player with no first name', { ...BOARD, players: { a: { f: 5, l: null, r: null } } }],
    ['a waiting list that is not ids', { ...BOARD, waiting: [1] }],
    ['too many players', { ...BOARD, waiting: Array.from({ length: 61 }, (_, i) => `p${i}`) }],
  ])('refuses %s', (_name, raw) => {
    expect(asBoard(raw)).toBeNull();
  });

  it('ignores a malformed team list rather than failing the board', () => {
    const got = asBoard({ ...BOARD, courts: [{ n: 1, status: 'playing', closing: false, teams: [['a'], ['c', 'd']] }] });
    expect(got?.courts[0].teams).toBeUndefined();
  });
});

describe('asLiveReply', () => {
  it('reads each state', () => {
    expect(asLiveReply({ state: 'idle' })).toEqual({ state: 'idle' });
    expect(asLiveReply({ state: 'paused', version: 3, age_s: 10 })).toEqual({ state: 'paused', version: 3, ageS: 10 });
    expect(asLiveReply({ state: 'live', version: 3, age_s: 4, unchanged: true })).toEqual({ state: 'live', version: 3, ageS: 4, unchanged: true });
    expect(asLiveReply({ state: 'live', version: 3, age_s: 4, show_photos: false, board: BOARD })).toEqual({ state: 'live', version: 3, ageS: 4, showPhotos: false, board: BOARD });
  });

  it('shows photos unless the server says they are off', () => {
    expect(asLiveReply({ state: 'live', version: 1, age_s: 0, board: BOARD })).toMatchObject({ showPhotos: true });
  });

  it('is null for anything else', () => {
    expect(asLiveReply(null)).toBeNull();
    expect(asLiveReply({ state: 'live', version: 3, age_s: 4, board: { title: 5 } })).toBeNull();
    expect(asLiveReply({ state: 'live', age_s: 4 })).toBeNull();
    expect(asLiveReply({ state: 'other', version: 1, age_s: 0 })).toBeNull();
  });
});

describe('asFaces', () => {
  const ok = { id: 'r-a', seq: 3, data: 'data:image/jpeg;base64,AAAA' };
  it('keeps good faces and drops bad ones one by one', () => {
    expect(asFaces([ok, { ...ok, data: 'https://evil.example/a.jpg' }, { ...ok, id: 5 }, { ...ok, data: 'data:image/png;base64,AAAA' }, { ...ok, id: 'r-b' }])).toEqual([ok, { ...ok, id: 'r-b' }]);
  });
  it('is empty for anything that is not a list', () => {
    expect(asFaces(null)).toEqual([]);
    expect(asFaces({})).toEqual([]);
  });
});
