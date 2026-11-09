import { describe, expect, it } from 'vitest';
import { norm, parsePlayerRow, pushRow } from './rows';

const ID = '0a1b2c3d-0000-4000-8000-00000000000a';
const good = {
  id: ID,
  name: 'Ann',
  photo_version: 2,
  photo_seq: 3,
  last_played_at: '2026-11-06T10:00:00+00:00',
  deleted_at: null,
  updated_at: '2026-11-06T10:00:01.123456+00:00',
};

describe('checking a row from the server', () => {
  it('turns a good row into the app\'s units', () => {
    expect(parsePlayerRow(good)).toEqual({
      id: ID,
      name: 'Ann',
      photoVersion: 2,
      photoSeq: 3,
      lastPlayedAt: Date.parse('2026-11-06T10:00:00Z'),
      updatedAt: Date.parse('2026-11-06T10:00:01.123Z'),
    });
  });

  it('reads a deleted row, and a row that was never played', () => {
    const row = parsePlayerRow({ ...good, last_played_at: null, deleted_at: '2026-11-06T11:00:00Z' });
    expect(row).toMatchObject({ deletedAt: Date.parse('2026-11-06T11:00:00Z') });
    expect(row).not.toHaveProperty('lastPlayedAt');
  });

  it('lowercases the id and trims the name the way JavaScript does', () => {
    expect(parsePlayerRow({ ...good, id: ID.toUpperCase(), name: '  Ann\t' })).toMatchObject({ id: ID, name: 'Ann' });
  });

  it.each([
    ['nothing', null],
    ['a string', 'row'],
    ['an id that is not a uuid', { ...good, id: 'p1' }],
    ['no id', { ...good, id: undefined }],
    ['no name', { ...good, name: undefined }],
    ['a name of only spaces and tabs', { ...good, name: ' \t  ' }],
    ['a name that is far too long', { ...good, name: 'x'.repeat(201) }],
    ['a negative photo version', { ...good, photo_version: -1 }],
    ['a photo version that is not whole', { ...good, photo_version: 1.5 }],
    ['a photo sequence that is a string', { ...good, photo_seq: '3' }],
    ['a photo sequence that is absurd', { ...good, photo_seq: 5_000_000 }],
    ['a played time that is not a time', { ...good, last_played_at: 'yesterday' }],
    ['a played time that is a number', { ...good, last_played_at: 5 }],
    ['a deleted time that is not a time', { ...good, deleted_at: 'x' }],
    ['no update time', { ...good, updated_at: null }],
    ['an update time that is not a time', { ...good, updated_at: 'soon' }],
  ])('rejects a row with %s', (_why, raw) => {
    expect(parsePlayerRow(raw)).toBeNull();
  });
});

describe('sending a player', () => {
  it('uses the server\'s column names and ISO times', () => {
    expect(
      pushRow({ id: ID, name: ' Ann ', photoVersion: 1, photoSeq: 2, lastPlayedAt: 1_000, updatedAt: 5, deletedAt: 2_000 }),
    ).toEqual({
      id: ID,
      name: 'Ann',
      photo_version: 1,
      photo_seq: 2,
      photo_revision: null,
      last_played_at: '1970-01-01T00:00:01.000Z',
      deleted_at: '1970-01-01T00:00:02.000Z',
    });
    expect(pushRow({ id: ID, name: 'Ann', photoVersion: 0, photoSeq: 0, updatedAt: 5 })).toMatchObject({
      last_played_at: null,
      deleted_at: null,
    });
  });

  it('compares names with the edges trimmed and the case ignored', () => {
    expect(norm('  ANN\t')).toBe('ann');
  });
});
