# Production release plan: audit remediation

Prepared 9 November 2026. Status: **not released, not pushed.** Nothing has been applied to any hosted Supabase database.

Target: Supabase project `pikl` (`jukjgwabutqetiwjnube`, ap-southeast-1). It is production. It is also the only active project. Vercel deploys the default branch (`claude/pickleball-matchmaking-app-i4baca`) to production on every push (per `docs/DEPLOY.md`; confirm in the Vercel dashboard before pushing).

## Blockers (all must clear)

1. ~~Rebase onto origin.~~ **Done locally, not pushed.** The branch was 40 commits behind origin; it is now 4 commits ahead and 0 behind. On the merged tree: 166 files / 2,419 tests, build, Playwright, concurrency, storage probe and 14-check flows all pass.
2. **Hosted gateway not proven by script (throwaway-user check skipped by decision, 9 Nov).** Replacement check: change one photo in the live app on the organizer's phone and confirm it syncs. If it errors, apply the emergency lever below. The scripts stay in the repo for a future staging project. Original note: **Hosted gateway not proven.** No non-production hosted project exists (branching needs Pro). **Chosen path: test on production with a disposable account of its own** (decided 9 Nov). It runs after step 5 of the sequence, because it needs the gate live.
   - Create the throwaway user yourself in the Supabase dashboard (Authentication, Add user) with a throwaway email. Claude does not create accounts on the production project.
   - Get its access token (a sign-in for that user, not the service-role key) and save a JSON file outside the repo with mode 600: `{ "staging": true, "url": "https://jukjgwabutqetiwjnube.supabase.co", "publishableKey": "...", "accessToken": "..." }`. The `staging: true` flag is only a human assertion that the account is disposable; here it does not mean a staging project.
   - Run `PIKL_CHECK_CREDENTIALS_FILE=<file> npm run test:release:storage` then `npm run test:release:flows`.
   - Why it cannot touch the organizer's data: every call is made with the throwaway user's token, so owner RLS, the `owner_id = auth.uid()` purge, and the `{user id}/...` storage paths confine it to that user. The flows script also refuses to start if the account already has any players.
   - Afterwards delete the user in the dashboard (its player rows cascade) and the credentials file.
   - If a check fails after step 5, use the emergency lever below before anything else.
3. **Your go-ahead to push**, to a branch you choose (see step 3).

## Before touching production

- **Backup not taken before step 2:** the export was blocked by the permission classifier and was not worked around. Step 2 cannot lose data, but take the export (dashboard, Table Editor, export players as CSV) before step 5 and the deploy.
- Export the `players` table (33 rows) to a private file **outside the repo** (personal data). Free plans have no point-in-time recovery. Storage objects are not changed by any migration.
- Tell the organizer the app will update and to tap **Reload now** afterwards.

## Sequence

| Step | Action | Effect on the live app |
|---|---|---|
| 1 | Done: rebased, full suite, build and release checks green on the merged tree, four commits typecheck individually. | None |
| 2 | **Applied to `pikl` on 9 Nov 2026** (recorded as versions `20261109065918` and `20261109065931`): `20261109130000_attendance_guest_lock` then `20261109140000_photo_revision`. Verified: `photo_revision` is a nullable uuid, 33 players unchanged, the guest function keeps its signature, security-definer flag and anon/authenticated grants, and the gate is not yet present. | Additive: a function replaced with the same grants, and one nullable column. The old app ignores the column. Safe before deploy. |
| 3 | Push. This deploys production. To get a preview first, push a differently named branch, but note Vercel previews will use whatever Supabase variables the project has set, so a preview points at production data. | New app goes live. Installed copies show "new version ready". |
| 4 | Organizer reloads. Verify sync, a photo edit, and the attendance card in the real app. | New client writes `photo_revision` and sends `x-pikl-sync-version: 2`. |
| 5 | **Applied to `pikl` on 9 Nov 2026** (version `20261109070615`, after the deploy of `ebcaa83` and the organizer's reload). Verified: five restrictive policies present (`players_current_insert/update`, `photos_current_insert/update/delete`), gate function granted to authenticated only, `delete_my_players` still security-definer with unchanged grants, 33 players and 32 photos unchanged. Security advisors show nothing new. Not yet verified through the hosted gateway: see step 6. Original step: apply `20261109150000_sync_version_gate` to `pikl`. | Old clients can read but not write, upload, delete photos or purge. Any tab not yet reloaded shows a generic sync error. Local data is untouched, so nothing is lost. |
| 6 | Post-gate checks (blocker 2 option A or B), and confirm a photo upload works from the live app. | |

Why the gate goes last: the handoff said to apply it before the new app. Applying it first would lock the organizer's installed app out of syncing until the deploy lands. The new client already reads legacy numeric photo filenames, so running both clients for a few minutes is safe with one real user. If more users exist by release time, reverse this and announce it.

Apply by migration name, in order, through the Supabase connection. Do not use `supabase db push`: production records different version numbers for the base migrations than the local filenames, and a push would try to replay them.

## Rollback and emergency levers

- Prefer a forward fix. Once UUID photo files exist, do not roll back to the old web build: it cannot read them.
- If the gate blocks the real app (for example the hosted Storage service does not forward the header): ship a migration that drops the five restrictive policies (`players_current_insert`, `players_current_update`, `photos_current_insert`, `photos_current_update`, `photos_current_delete`) and recreates `delete_my_players` without the check. Nothing is lost; sync resumes.
- If the new app misbehaves before step 5: redeploy the previous Vercel build. Step 2 migrations are additive and stay.

## Known limits that remain after release

- Account deletion is not a global barrier across devices with pending edits.
- Replaced photo files are kept (no garbage collection).
- Web Locks protect cooperating updated tabs only.
- The notice wording blames "another window" for every lock-holder case.
- Real-phone, installed-PWA and Safari lifecycle are untested.
- The concurrency script has no negative control and does not prove the 40 calls overlap. The Playwright spec only works against the dev server.
- Dependency advisories: build and test tooling only, see the handoff for the table. Both follow-ups (vitest 5, `npm audit fix` for the PWA chain) are separate PRs.
