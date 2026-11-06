# Pickleball Matchmaker

Automatic matchmaking for pickleball open play. Create a session, set the number of courts, add players, and the app decides who plays on which court and who goes next when a game ends. Works on phones and desktops, installs as an app, and works offline.

## Features

- **Fairness mode** (default): the players with the fewest games play next, then whoever has waited longest; teams are split to avoid repeat partners and opponents.
- **Simple queue mode**: the classic paddle stack — finishers go to the back of the line.
- Late arrivals, breaks, leaving early, adding/removing courts mid-session, and undo.
- A saved player roster on the device, so you don't retype names each session.
- Light and dark themes.

## Develop

```bash
npm install
npm run dev        # start the dev server
npm test           # run all tests once
npm run typecheck
npm run build      # production build (also generates the service worker)
npm run preview    # serve the production build locally
```

## Layout

- `src/engine/` — pure matchmaking logic (no React, no browser APIs).
- `src/store/` — session store (undo + localStorage) and the IndexedDB roster.
- `src/ui/` — React screens and components.
- `docs/superpowers/specs/` — design spec. `docs/superpowers/plans/` — implementation plans.
