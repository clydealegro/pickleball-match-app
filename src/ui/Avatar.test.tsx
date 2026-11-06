import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, initials } from './Avatar';

describe('initials', () => {
  it('uses first and last word initials', () => {
    expect(initials('Ann Lee')).toBe('AL');
    expect(initials('mary jane watson')).toBe('MW');
  });

  it('uses the first two letters of a single word', () => {
    expect(initials('Ben')).toBe('BE');
    expect(initials('x')).toBe('X');
  });

  it('does not split emoji and other astral characters', () => {
    expect(initials('😀 Ann')).toBe('😀A');
    expect(initials('😀')).toBe('😀');
  });

  it('falls back to a question mark', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('Avatar', () => {
  it('shows initials without a photo', () => {
    render(<Avatar name="Ann Lee" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows the photo when a url is given', () => {
    render(<Avatar name="Ann Lee" photoUrl="blob:x" />);
    expect(screen.getByRole('img', { name: 'Ann Lee' })).toHaveAttribute('src', 'blob:x');
  });
});
