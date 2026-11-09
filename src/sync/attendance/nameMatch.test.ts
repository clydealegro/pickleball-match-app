import { describe, expect, it } from 'vitest';
import type { RosterPlayer } from '../../store/rosterDb';
import { nameMatch } from './nameMatch';

const p = (id: string, name: string): RosterPlayer => ({ id, name, photoVersion: 0, photoSeq: 0, updatedAt: 1 });
const roster = [p('1', 'Ana Reyes'), p('2', 'Ben Cruz'), p('3', 'Ben Dale'), p('4', 'Cy')];

describe('nameMatch', () => {
  it('is exact for the same name, ignoring case and spaces at the ends', () => {
    expect(nameMatch('ana reyes', roster)).toEqual({ kind: 'exact', player: roster[0] });
    expect(nameMatch('  BEN CRUZ  ', roster)).toEqual({ kind: 'exact', player: roster[1] });
    expect(nameMatch('Cy', roster)).toEqual({ kind: 'exact', player: roster[3] });
  });

  it('is likely for the same first word and a different name', () => {
    expect(nameMatch('Ana Lopez', roster)).toEqual({ kind: 'likely', player: roster[0] });
    expect(nameMatch('ana', roster)).toEqual({ kind: 'likely', player: roster[0] });
    expect(nameMatch('Cy Tan', roster)).toEqual({ kind: 'likely', player: roster[3] });
  });

  it('takes the first saved player when several share the first word', () => {
    expect(nameMatch('Ben Smith', roster)).toEqual({ kind: 'likely', player: roster[1] });
  });

  it('prefers an exact match over an earlier likely one', () => {
    expect(nameMatch('Ben Dale', roster)).toEqual({ kind: 'exact', player: roster[2] });
  });

  it('is none when nothing lines up', () => {
    expect(nameMatch('Zed Zane', roster)).toEqual({ kind: 'none' });
    expect(nameMatch('Anabel', roster)).toEqual({ kind: 'none' });
  });

  it('is none for an empty roster or a blank name', () => {
    expect(nameMatch('Ana', [])).toEqual({ kind: 'none' });
    expect(nameMatch('   ', roster)).toEqual({ kind: 'none' });
    expect(nameMatch('', roster)).toEqual({ kind: 'none' });
  });

  it('has no player when there is none', () => {
    expect(nameMatch('Zed', roster)).not.toHaveProperty('player');
  });

  it('splits the first word on any run of spaces', () => {
    expect(nameMatch('Ana   Lopez', roster)).toEqual({ kind: 'likely', player: roster[0] });
  });
});
