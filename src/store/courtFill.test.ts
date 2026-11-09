import { describe, expect, it } from 'vitest';
import { courtFill } from './courtFill';

describe('courtFill', () => {
  it('says how many more make a game below four', () => {
    expect(courtFill(0)).toEqual({ groups: [0, 0], caption: '4 players make a game' });
    expect(courtFill(1)).toEqual({ groups: [1, 0], caption: '3 more makes a game' });
    expect(courtFill(3)).toEqual({ groups: [3, 0], caption: '1 more makes a game' });
  });

  it('counts full courts and the ones waiting from four up', () => {
    expect(courtFill(4)).toEqual({ groups: [4, 0], caption: '1 court full' });
    expect(courtFill(6)).toEqual({ groups: [4, 2], caption: '1 court full, 2 waiting' });
    expect(courtFill(8)).toEqual({ groups: [4, 4], caption: '2 courts full' });
    expect(courtFill(9)).toEqual({ groups: [4, 4, 1], caption: '2 courts full, 1 waiting' });
  });

  it('shows at most four courts in the bar but keeps counting in the caption', () => {
    expect(courtFill(20)).toEqual({ groups: [4, 4, 4, 4], caption: '5 courts full' });
  });

  it('treats a negative or fractional count as a whole, non-negative one', () => {
    expect(courtFill(-2).caption).toBe('4 players make a game');
    expect(courtFill(2.9).caption).toBe('2 more makes a game');
  });
});
