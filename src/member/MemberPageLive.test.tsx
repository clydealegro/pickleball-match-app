import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveBoard } from '../sync/live/board';
import type { LiveViewReply } from './liveTypes';
import { memoryRemote } from './fixtures';
import { MemberPage } from './MemberPage';
import { MemberError, type MemberRemote } from './remote';

const CODE = 'abc123';
const BOARD: LiveBoard = {
  title: 'Tuesday open play',
  venue: 'Nitro',
  courts: [{ n: 1, status: 'playing', closing: false, startedAt: Date.now() - 120_000, teams: [['a', 'b'], ['c', 'd']] }],
  players: { a: { f: 'Ana', l: null, r: null }, b: { f: 'Ben', l: null, r: null }, c: { f: 'Cy', l: null, r: null }, d: { f: 'Dee', l: null, r: null } },
  waiting: [],
  onBreak: [],
};
const live = (reply: LiveViewReply | (() => Promise<LiveViewReply>)): MemberRemote => ({
  ...memoryRemote(),
  live: vi.fn(async () => (typeof reply === 'function' ? reply() : reply)),
  liveFaces: vi.fn(async () => []),
});

beforeEach(() => {
  localStorage.clear();
  document.title = 'PIKLMatch';
});
afterEach(() => cleanup());

describe('the member page with a live board', () => {
  it('shows the live board instead of the list when one is up', async () => {
    render(<MemberPage code={CODE} remote={live({ state: 'live', version: 1, ageS: 2, showPhotos: true, board: BOARD })} />);
    expect(await screen.findByRole('region', { name: 'Live board' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Tuesday open play' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('PIKL')).toBeInTheDocument();
    // None of the attendance page: no list to pick a name from, no In, Maybe or Out.
    expect(screen.queryByRole('button', { name: /^(In|Maybe|Out)$/ })).not.toBeInTheDocument();
    expect(document.title).toBe('Tuesday open play');
  });

  it('shows the attendance list when no board is up', async () => {
    render(<MemberPage code={CODE} remote={live({ state: 'idle' })} />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live board' })).not.toBeInTheDocument();
  });

  it('says it is opening the list while it finds out whether a board is up', () => {
    render(<MemberPage code={CODE} remote={live(() => new Promise(() => undefined))} />);
    expect(screen.getByText('Opening the list')).toBeInTheDocument();
  });

  it('says the organizer paused the board', async () => {
    render(<MemberPage code={CODE} remote={live({ state: 'paused', version: 1, ageS: 4 })} />);
    expect(await screen.findByText('The organizer paused the live board. It will come back by itself.')).toBeInTheDocument();
  });

  it('falls back to the list when the server has no live board at all', async () => {
    const remote = live(async () => {
      throw new MemberError('server');
    });
    render(<MemberPage code={CODE} remote={remote} />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Live board' })).not.toBeInTheDocument();
  });

  it('is unchanged for a remote that has no live board', async () => {
    render(<MemberPage code={CODE} remote={memoryRemote()} />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});
