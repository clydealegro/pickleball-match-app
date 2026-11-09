# Release validation

Run from the app directory after `npm install`.

- `npm run test:release:db` starts a disposable PostgreSQL 17 Docker container, applies all migrations to Supabase schema stand-ins, sends 40 requests across independent connections and requires exactly 20 acceptances. Docker must be running. The container is removed afterward; no port or existing database is used.
- `npm run test:release:browser` uses installed Google Chrome, starts a backend-disabled Vite server on port 4174, and checks the single-writer lease, handoff after closing/reloading, and session persistence. Close any existing server on that port first.
- `npm run test:release:storage` checks the actual staging Supabase Storage gateway. Supply a protected JSON file via `PIKL_CHECK_CREDENTIALS_FILE` with `staging: true`, `url`, `publishableKey`, and a staging test-user `accessToken`. Keep this file outside the repository. Never use a service-role key. Apply the audit migrations to staging first. The probe creates one random test object and cleans it up. No production credentials are required.

- `npm run test:release:flows` runs 14 checks with the same credentials file: legacy roster/photo/purge denial, current-client sync, two photo revisions, competing edits and a test-account-only purge. The account must start with no players.

## Observed results

See `docs/CLAUDE-CODE-HANDOFF.md`, "Evidence actually obtained", for the dated results and what is not verified. Summary: unit suite, build, Playwright, real-PostgreSQL concurrency, and the storage and flows checks on a local Supabase stack all passed. The hosted gateway has only been checked for CORS preflight; no hosted non-production project exists.

Deploy order and rollback are in `docs/RELEASE-PLAN.md`.
