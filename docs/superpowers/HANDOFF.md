# Handoff: where the project stands

Written at the end of the first working session so a new session (on any machine) can continue without the original conversation.

## What this is
A pickleball open-play matchmaking web app. An organizer creates a session, sets the number of courts, adds players, and the app assigns games and decides who goes next when a game ends. It works on phones and desktops, installs as an app, and works offline. The organizer previously did this by hand with "paddle stacking".

## Status
- **Plan 1 (core app) is complete, reviewed, and pushed.** 153 tests pass, the typecheck is clean, `npm run build` works, and the built app was checked offline in a real browser.
- **Deployed to Vercel at https://piklmatch.vercel.app** (the Plan 1 build; the owner imported the repo on 6 Nov 2026, and the `pikl` name was not used). Checked live: the page, manifest, icons, hashed assets and service worker all load, and a session can be started and a game finished. `docs/DEPLOY.md` still says `pikl.vercel.app`; that was the planned name.
- **Plan 2 (photos) is complete and live on production** (6 Nov 2026, commit `6036d75`, https://piklmatch.vercel.app): 203 tests pass, the typecheck is clean, `npm run build` works. Each task was spec-reviewed and quality-reviewed, review fixes were applied, and a final whole-branch review found nothing blocking. Checked live in desktop Chrome: the old build's version 1 database upgrades to version 2 through **Reload now** with all saved players intact, a portrait photo is cropped to a 256 px square and saved, it survives a reload and shows on the court card, and the `Permissions-Policy: camera=(self)` header is served. **Not yet checked on a real phone (Task 10 of the plan):** camera rotation of a real portrait photo on iOS and Android, `capture` from an installed iOS PWA, HEIC from the iOS library, and the update keeping saved players on a phone. Plan: `docs/superpowers/plans/2026-11-06-photos.md`. Open review items are in the notes file.
- **Plan 3 (Supabase auth + sync) is designed (in the spec) but not planned or built.**

## Where things are
| What | Where |
|---|---|
| Design spec (the source of truth for behaviour) | `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md` |
| Plan 1 (executed; its code blocks equal the repo for `src/`, `vite.config.ts`, `index.html`, `package.json`) | `docs/superpowers/plans/2026-11-06-core-matchmaking-app.md` |
| Plan 2 (photos): 10 tasks, tasks 1 to 9 replayed step by step on a fresh clone | `docs/superpowers/plans/2026-11-06-photos.md` |
| Review follow-ups and prerequisites for Plans 2 and 3 | `docs/superpowers/notes/2026-11-06-follow-ups-and-plan-2-3-prerequisites.md` |
| Deployment guide | `docs/DEPLOY.md` |
| Engine (pure logic, no React) | `src/engine/` |
| Stores (session + undo + localStorage; roster in IndexedDB) | `src/store/` |
| React screens | `src/ui/` |

## Develop
Needs Node 20 or newer.
```bash
npm install
npm run dev        # dev server
npm test           # all tests once (expect 153 passing)
npm run typecheck
npm run build      # also generates the service worker
```

## Decisions already made (don't re-ask the owner)
- One organizer runs each session from one device. The live session stays on that device; only the roster and photos go online later.
- Default matchmaking is **fairness** (fewest games first, then waited longest, then a stable random tie-break; teams split to avoid repeat partners/opponents). **Simple queue** (classic paddle stack) is the alternative.
- No scores or skill ratings in v1.
- Roster and photos are **local-first** (IndexedDB) and sync to Supabase in the background when signed in. Sign-in is an emailed one-time code, with no password. The app works signed out.
- Visual style: clean and minimal, off-white background, one **lime** accent used only for live things, rounded cards, one dark pill primary button, light and dark themes.
- Engine rules: names are unique among players who have not left; a player returning from a break gets `max(own games, floor(average of other active players))`; starting with fewer than 4 players is blocked by the Setup screen, not the engine.
- Updates never reload the page by themselves (an in-app "Reload now" notice instead).

## Suggested next steps (in order)
1. **Try a real session at the courts** on the deployed app (it is already live).
2. **Check photos on a real phone** (Task 10 of `docs/superpowers/plans/2026-11-06-photos.md`): take a portrait photo and confirm it is upright, try the library picker and a HEIC photo, then Reload now on the installed app and confirm the saved players are still there.
3. **Plan 3: Supabase.** Write a plan from "Sync and backend (Supabase)": a Supabase project, migrations with row-level security and a private `player-photos` bucket, email-code sign-in, an outbox with push/pull sync, the sync status line, and "Delete all my data".
4. Smaller leftovers are listed in the notes file.

## How the work was done (so you can follow the same rhythm)
Brainstorm → spec → plan with complete code blocks → execute task by task with tests first → spec-compliance review, then code-quality review per layer → fix → final review. The plan was replayed task by task in a scratch directory to prove the order works (tests red then green, typecheck, build). That replay tooling lived outside the repo; recreate something similar if you write another plan.
