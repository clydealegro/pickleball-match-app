import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Hello({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe('tooling', () => {
  it('renders React in jsdom with jest-dom matchers', () => {
    render(<Hello name="court" />);
    expect(screen.getByText('Hello court')).toBeInTheDocument();
  });

  it('provides IndexedDB and localStorage', () => {
    expect(typeof indexedDB.open).toBe('function');
    localStorage.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    localStorage.clear();
  });
});
