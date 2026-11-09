import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { nameHue } from '../store/boardInfo';
import { MemberTile } from './MemberTile';

describe('MemberTile', () => {
  it('shows the initials of the name', () => {
    const { container } = render(<MemberTile name="Ana" />);
    expect(container.firstElementChild).toHaveTextContent('AN');
  });

  it('uses two letters from a name with a last initial: first and last', () => {
    const { container } = render(<MemberTile name="Ben C." />);
    expect(container.firstElementChild).toHaveTextContent('BC');
  });

  it('is hidden from screen readers, because the parent shows the name', () => {
    const { container } = render(<MemberTile name="Ana" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes its colour from the name', () => {
    const { container } = render(<MemberTile name="Ana" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.getPropertyValue('--h')).toBe(String(nameHue('Ana')));
    const other = render(<MemberTile name="Zed" />).container.firstElementChild as HTMLElement;
    expect(other.style.getPropertyValue('--h')).toBe(String(nameHue('Zed')));
  });

  it('is the medium size by default and the small size when asked', () => {
    const md = render(<MemberTile name="Ana" />).container.firstElementChild;
    expect(md).toHaveClass('member-tile', 'member-tile-md');
    const sm = render(<MemberTile name="Ana" size="sm" />).container.firstElementChild;
    expect(sm).toHaveClass('member-tile', 'member-tile-sm');
    expect(sm).not.toHaveClass('member-tile-md');
  });
});
