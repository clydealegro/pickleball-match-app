# Pickleball Matchmaking App — Design

Date: 2026-11-06

## Purpose

Replace manual paddle stacking at pickleball sessions. An organizer creates a session, sets the number of courts, adds players, and the app decides who plays on which court and who plays next when a game ends. It works on a phone, tablet, or desktop.

## Scope (v1)

**In scope**
- One organizer runs the session from a single device. No accounts, no backend.
- Two matchmaking modes: **fairness** (default) and **simple queue** (classic paddle stack).
- Courts, players, a waiting list, an "up next" preview, and undo.
- Late arrivals, breaks, leaving early, adding and removing courts mid-session.
- State is saved in the browser; installable as a PWA; works offline.
- Responsive UI with a clean, minimalist look; light and dark themes.

**Out of scope for v1 (possible later)**
- Live sync so players can follow along on their own phones (needs a backend; the storage layer is isolated so it can be swapped).
- Score entry and leaderboards.
- Skill ratings and skill-balanced teams.
- Accounts, saved player groups across devices, session history beyond the current device.

## Architecture

React + TypeScript + Vite single-page app, deployed as a static site.

Three layers with one-way dependencies (UI → store → engine):

1. **Engine** (`src/engine/`) — pure TypeScript, no React, no browser APIs. Functions take a session state plus an action and return a new state. Randomness comes from an injected RNG so tests are deterministic.
2. **Store** (`src/store/`) — holds the current state, a bounded undo stack, and persistence to `localStorage`. It is the only layer that touches storage, so live sync can later replace it without changing the engine or screens.
3. **UI** (`src/ui/`) — screens and components. Reads state from the store and dispatches actions. Contains no matchmaking logic.

## Data model

```
Session {
  id, name, mode: 'fairness' | 'queue',
  courts: Court[],
  players: Player[],
  queueOrder: PlayerId[],      // used in queue mode
  history: FinishedGame[],
  gameSeq: number,             // increments each time a game finishes
  createdAt, endedAt?
}

Court {
  id, number,
  status: 'empty' | 'playing',
  closing: boolean,            // remove after current game ends
  game?: { team1: [PlayerId, PlayerId], team2: [PlayerId, PlayerId], startedAt }
}

Player {
  id, name,
  status: 'active' | 'break' | 'left',
  pendingStatus?: 'break' | 'left',   // applies when their current game ends
  gamesPlayed: number,
  lastFinishedSeq: number,     // gameSeq when they last finished (or joined/returned)
  partnerCounts: Record<PlayerId, number>,
  opponentCounts: Record<PlayerId, number>
}

FinishedGame { team1, team2, courtNumber, startedAt, finishedAt }
```

`startedAt` is a timestamp, so court timers survive refreshes.

## Matchmaking engine

### Available pool

Every player with `status === 'active'` who is not currently on a court.

### Fairness mode (default)

When a court becomes empty (game finished, court added, or enough players become available) and the pool has at least 4 players:

1. **Select 4 players** from the pool, sorted by: fewest `gamesPlayed`, then smallest `lastFinishedSeq` (waited longest), then random (injected RNG).
2. **Split into teams.** Of the 3 possible pairings of the 4 players, choose the one with the lowest cost, where
   `cost = 10 × (partner repeats within both teams) + (opponent repeats across the 4 cross-team pairs)`.
   Ties are broken randomly.
3. **Start the game** on that court, recording `startedAt`.

If several courts are empty at once, they are filled one at a time, each removing its 4 players from the pool before the next court is filled.

### Simple queue mode

`queueOrder` is a FIFO list of available players.
- The next 4 in line take an empty court. The first two of the four form team 1 and the last two form team 2.
- When a game finishes, its 4 players go to the back of the queue in the order they were on court (team 1, then team 2).
- Late arrivals and players returning from a break join at the back.
- Games played is still tracked and displayed.

### Game lifecycle

- **Finish game:** record the game in `history`, increment `gameSeq`, update each player's `gamesPlayed`, `lastFinishedSeq`, `partnerCounts`, and `opponentCounts`, apply any `pendingStatus`, free the court (or remove it if `closing`), then refill empty courts.
- **Fewer than 4 available:** the court stays empty and fills automatically as soon as enough players are available.
- **Up next preview:** the engine can compute the next game for an empty or soon-to-finish court without committing it; the UI shows who would play next. The preview is advisory: the actual selection is recomputed when the court frees up.

### Roster changes

- **Late arrival (new player):** `gamesPlayed` starts at the floor of the average `gamesPlayed` of active players (0 if none), and `lastFinishedSeq` is the current `gameSeq`. This prevents a new player from being put on every court in a row to catch up.
- **Break:** if the player is waiting, status becomes `break` immediately and they are skipped. If they are on a court, `pendingStatus = 'break'` and it applies when their game ends.
- **Return from break:** status becomes `active`, treated as a late arrival (same starting `gamesPlayed` and `lastFinishedSeq` rule; in queue mode they join at the back).
- **Leave:** same as break, with status `left`. A player who has left can be re-added only as a new entry.
- **Names** must be non-empty and unique within the session (case-insensitive).

### Court changes

- **Add court:** gets the next court number and fills immediately if enough players are available.
- **Remove court:** an empty court is removed immediately; a court in play is marked `closing` and removed when its game ends.
- At least one court must remain.

### Undo

The store keeps a bounded stack (50) of previous states. Undo restores the previous state exactly, including a finished game, roster changes, and court changes.

## Screens

Mobile-first. On wide screens the same content uses a two-column layout.

### 1. Setup

- Session name, number of courts (stepper), mode (fairness / simple queue) as option chips.
- Add players by typing names one at a time or pasting a list (one name per line).
- A single "Start session" button at the bottom. Disabled until there are at least 4 players.

### 2. Live session (main screen)

- **Court cards:** court number, both teams, a running timer, and a primary "Game finished" button. An empty court shows "Waiting for players".
- **Up next:** large and prominent; shows the next 4 players and which court they'll go to.
- **Waiting list:** one row per player with a games-played badge. Tapping a player opens actions: Break / Return / Leave.
- **Add player:** a dashed card at the end of the list.
- **Session controls:** add court, remove court, undo, end session.
- **Layout:** mobile stacks courts, then up next, then waiting list. Desktop puts courts in the main column and up next plus the waiting list in a side column.

### 3. Summary

- Per-player: games played and partners faced.
- Copy-to-clipboard export of the session results.
- "Start new session" returns to Setup.

## Visual design

Reference screens were gathered from Mobbin: Tempo (setup chips and dark pill button), Strava and Bevel (form and list patterns, dashed "add" card), Peloton (multi-select list), Equinox+ and Waymo (queue position), Apple Sports and DAZN (numbered rows), Time2book (minimal web layout with a left accent bar on cards).

- **Palette:** off-white background (`#FAFAF7`), near-black text (`#111111`), neutral grays for borders and secondary text, one accent: **pickleball lime** (`#C8F03C`). The accent is used only for live things (active court bar, "Game finished", "Up next"). It is always a fill behind dark text, never a text color on white.
- **Shape and type:** rounded cards with soft borders, no heavy shadows, one sans-serif typeface. Court numbers, timers, and the "Up next" names are large enough to read from a few feet away.
- **Actions:** one dark pill primary button per screen.
- **Themes:** light by default, with a dark theme toggle (dark background, lime accent unchanged). Respects the system setting on first load.
- **Touch targets:** at least 44px.
- **Accessibility:** text contrast meets WCAG AA in both themes; state is never conveyed by color alone.

## Persistence and offline

- The full session state and undo stack are written to `localStorage` after every action (key includes a schema version).
- On load, the saved session is restored; if the saved data is corrupt or from an incompatible version, the app starts at Setup and does not crash.
- A service worker caches the app shell so it works with no signal. The app is installable as a PWA.

## Error handling

- Invalid inputs (empty or duplicate names, fewer than 4 players to start, removing the last court) are rejected in the engine with a typed error and shown inline in the UI.
- Engine functions never throw for valid-but-unusual states (e.g. no courts empty, empty pool); they return the state unchanged.
- Storage failures (private mode, quota) are caught; the app keeps working in memory and shows a small "not saved" notice.

## Testing

- **Engine unit tests (Vitest):** fewest-games-first selection; waited-longest tie-break; partner and opponent repeat minimization; seeded randomness; fewer than 4 available; multiple empty courts; queue mode ordering; late arrival starting value; break/leave immediate and pending; court add/remove (including `closing`); undo; finishing games updates counts.
- **Property-style check:** over a long simulated session with a fixed roster (e.g. 13 players, 3 courts, 100 games, no breaks or late arrivals), no active player's games played differs from another's by more than 1 whenever all courts are idle between rounds.
- **Store tests:** persistence round trip, corrupt-data fallback, undo stack bound.
- **UI tests (Testing Library):** create a session, finish a game, mark a break, undo — the main happy path.

## Project structure

```
src/
  engine/     # pure logic + tests
  store/      # state, undo, persistence + tests
  ui/         # screens and components
  styles/     # tokens (colors, spacing, type), themes
public/       # PWA manifest, icons
docs/superpowers/specs/
```
