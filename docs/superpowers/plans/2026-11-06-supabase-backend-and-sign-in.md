# Supabase Backend and Sign-in Implementation Plan (Plan 3A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the online backup's backend and let the organizer sign in with an emailed six-digit code: a Supabase project with a `players` table, a private `player-photos` bucket and a purge function, all protected by row-level security and tested; plus a Settings screen with sign-in and sign-out. Nothing is synced yet.

**Architecture:** The security rules live in the database as versioned SQL migrations in `supabase/migrations/`, and are tested on every `npm test` against an in-memory Postgres (PGlite) given Supabase-shaped stand-ins, and once on the real project with a rollback-only script. The app talks to Supabase through one small client module that returns `null` when no backend is configured, so the app keeps working signed out. A Zustand sign-in store wraps Supabase Auth's email code flow and a Settings screen shows it.

**Tech Stack:** React 18, TypeScript, Vite 6, Zustand 5, Vitest 3 + Testing Library, `@supabase/supabase-js` 2.118.0, `@electric-sql/pglite` 0.5.14 (tests only). Both new dependencies are pinned to exact versions.

**Spec:** `docs/superpowers/specs/2026-11-06-pickleball-matchmaking-design.md`, section "Sync and backend (Supabase)".

**Roadmap:** Plan 1 (core app) and Plan 2 (photos) are live. Plan 3 is split in two, as the planning skill advises when a spec covers independent parts, so each plan ships something that works and can be tested alone. **Plan 3A is this plan.** Plan 3B (the local data changes and the sync itself) is outlined at the end and is written after 3A ships, because it builds on a backend that exists.

**Follow-ups this plan absorbs:** from `docs/superpowers/notes/2026-11-06-follow-ups-and-plan-2-3-prerequisites.md`: a monotonic `photo_seq` for storage file names (the version-reuse finding), and "Delete all my data" via a function plus the Storage API. The rest of that file belongs to Plan 3B.

## Decisions made while planning

1. **Two plans.** 3A is the backend and sign-in. 3B is the sync engine and its local data changes.
2. **A new Supabase project named `pikl`.** The organization already has four projects: `pikl-web-app` (paused, contents unknown), `dinktheory` and `YT Summarizer` (paused), and `lions-hvac-pay-run` (active, looks like separate client work). None is touched by this plan. Task 1 gates on a cost check and your yes before anything is created.
3. **The email must be edited to send a code.** Supabase sends a magic link by default. A six-digit code only arrives when the email template contains `{{ .Token }}`. Task 1 edits both the "Magic Link" and the "Confirm sign up" templates, because the docs do not say which a brand-new address receives. The built-in email service also only sends to your organization's team members, so your own address works and a stranger's does not until custom SMTP is set up.
4. **The rules are tested twice.** On every test run against an in-memory Postgres (fast, but with stand-ins for Supabase's roles, `auth.uid()` and storage), and once against the real project (Tasks 6 and 7).
5. **`photo_seq`.** The table gets a column that only ever goes up and names the storage file. `photo_version` keeps its Plan 2 meaning (a count that can return to 0), so a removed and re-added photo can no longer reuse a file path. Plan 3B adds the matching local field.
6. **Purge needs two parts.** A database function deletes the rows. Storage files are removed through the Storage API, never with SQL, which would orphan them. The function ships here; the app side ships in Plan 3B.
7. **Nothing reaches the app until the two settings exist.** Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` the Supabase code is left out of the build entirely and the app is exactly as it is today. With them it adds about 59 KB gzip (measured), accepted because Plan 3B needs auth, rows and file storage.
8. **A secret key can never be shipped by accident.** The client refuses a `sb_secret_` key or an old `service_role` key, logs why, and runs as if nothing were configured.
9. **Sign-in does nothing yet beyond signing in.** The Settings copy says backing up comes later. The "Sign in to back up" banner and the sync status line belong to Plan 3B, where they become true.
10. **New sign-ups stay allowed** so your first sign-in creates your account. Task 1 and Task 11 describe turning sign-ups off afterwards.

## Conventions

- New files are given in full. Changes to existing files are given as **replace this exact text with this text**; each "replace" text appears exactly once in the file at that point in the plan.
- **Starting point:** commit `4163218`, the tip of the `photos` branch: Plan 2 as it is live, plus one test-only fix (a Plan 2 test that read the roster before the adds finished; it failed once on a clean clone). Production is at `524ac61`, which differs only by that fix, so either merge `photos` into the production branch first or branch from it.
- Run every command from the repo root. Run `npm ci` once first on a fresh clone.
- Needs Node 20 or newer.
- Commit messages follow the repo's style (`feat:`, `fix:`, `chore:`). Add no attribution lines.
- **What was and was not run when this plan was written.** Tasks 2 to 6, 8 to 10 and the deploy-guide edit in Task 11 were replayed step by step on a fresh clone: every "expected to fail" step failed as written, every "expected to pass" step passed, and every commit succeeded. Tasks 1, 7 and the rest of Task 11 need the real Supabase project, Vercel or a phone, and were **not run**. The in-memory database tests use stand-ins for Supabase; Task 7 is what proves the rules on the real thing.

## Rollout

Tasks 2 to 6 and 8 to 10 do not need the Supabase project. They can be built and merged first: production is unchanged except for a Settings screen that says sign-in is not set up. Do Task 1 whenever it suits, but before Task 7. Task 11 is the switch that turns sign-in on.

## File structure

| File | What changes |
|---|---|
| `package.json`, `package-lock.json` | Task 2: two pinned dependencies |
| `src/vite-env.d.ts`, `.env.example` | Task 2: the two public settings |
| `supabase/migrations/*.sql` | Tasks 3 to 5 (new): table, bucket and policies, purge function |
| `supabase/tests/real-project-check.sql` | Task 6 (new): rollback-only check for the real project |
| `src/sync/db/*` | Tasks 3 to 6 (new): the in-memory Postgres harness and the database tests |
| `src/sync/client.ts`, `src/sync/auth.ts` (+ tests) | Tasks 8 and 9 (new): client with the secret-key guard, and the sign-in store |
| `src/ui/SettingsScreen.tsx`, `src/ui/settings.test.tsx` | Task 10 (new) |
| `src/ui/App.tsx`, `SetupScreen.tsx`, `SavedPlayersScreen.tsx` | Task 10: Settings view, button, sign-in state |
| `docs/DEPLOY.md` | Task 11: the two settings |

---

### Task 1: Choose the Supabase project and set up the sign-in email
Nothing in this task touches code, and nothing in it can be tested without the real project, so it is not replayed. It matters because three facts from the Supabase docs change what you must do. First, the default sign-in email is a **magic link**, not a code. A six-digit code only arrives once the email template contains `{{ .Token }}`. Second, the built-in email service **sends only to the email addresses of your Supabase organization's team members** (any other address fails with the error code `email_address_not_authorized`) and has one hourly cap shared by the whole project; the docs call it a service for trying out Auth, and say custom SMTP is needed to send to any address. That is fine for a single organizer whose own address belongs to the organization, and it is a hard stop for anyone else until custom SMTP is set up. Third, the docs list "Confirm sign up" and "Magic link or OTP" as separate templates and do not say which one a brand-new address receives, so this task edits both and Task 11 checks with a new address and an existing one.
**Files:**
- None. Supabase dashboard (or the Supabase MCP tools) only.

- [ ] **Step 1: Pick the project**

  Your Supabase account, as read on 6 Nov 2026:
  
  | Project | Status | Created | Region | Note |
  |---|---|---|---|---|
  | `pikl-web-app` | paused | Aug 2026 | ap-southeast-1 | Name suggests it is this app, but nothing in this repo points at it and its contents are unknown. |
  | `dinktheory` | paused | Jun 2026 | ap-southeast-1 | Unrelated as far as the repo shows. |
  | `YT Summarizer` | paused | Jun 2025 | ap-southeast-1 | Unrelated. |
  | `lions-hvac-pay-run` | **active** | Oct 2026 | us-west-1 | Looks like separate client work. **Do not use or change it.** |
  
  The organization is `RobotBeard` (id `ocrzorsxwejpoifsdacs`).
  
  **Recommendation: create a new project named `pikl`** in `ap-southeast-1` (the closest region to the Philippines). A new project starts with no unknown data, no old policies and no shared settings. Reusing `pikl-web-app` means restoring a paused project first and finding out what is in it, so only do that if you know it is empty or yours to reuse.
  
  How many active projects the organization's plan allows is not stated in the docs this plan was written from. The cost check below states the price for a new project in this organization, so run it before anything else.
  
  - Cost check: use the Supabase MCP tool `get_cost` with `type: "project"` and `organization_id: "ocrzorsxwejpoifsdacs"`. Read the price back to the owner and wait for a clear yes. Then `confirm_cost`, then `create_project` with the name `pikl` and the region above. Or create it in the dashboard.
  - Wait until `get_project` reports `ACTIVE_HEALTHY`.

- [ ] **Step 2: Make the sign-in email send a code**

  In the dashboard: **Authentication, Email Templates**. Edit **both** the **Magic Link** template and the **Confirm sign up** template. Give each this subject and body (any wording is fine, as long as it contains `{{ .Token }}`):
  
  Subject: `Your Pikl sign-in code`
  
  ```html
  <h2>Your sign-in code</h2>
  <p>Enter this code in the app:</p>
  <p style="font-size: 24px; letter-spacing: 4px"><strong>{{ .Token }}</strong></p>
  <p>It works once and expires soon. If you did not ask for it, ignore this email.</p>
  ```
  
  Leave **Email OTP Expiration** at its default (**Authentication, Providers, Email**), and do not change the code length: the app expects six digits. The docs cap it at 86400 seconds (one day) because a longer life gives an attacker more time to guess.

- [ ] **Step 3: Set the site address and check the email limits**

  - **Authentication, URL Configuration**: set **Site URL** to `https://piklmatch.vercel.app`. The app signs in with a typed code and never follows a link, but the default points at `localhost`.
  - **Organization, Team**: confirm the email address you will sign in with is a member of the `RobotBeard` organization. The built-in email service sends only to team members, and fails for every other address with `email_address_not_authorized`.
  - **Authentication, Rate Limits**: read the numbers for emails per hour and OTPs per hour. The built-in service shares one hourly cap across the whole project. To send codes to any other address, or to raise the limit, set up custom SMTP (the guide is at https://supabase.com/docs/guides/auth/auth-smtp).
  - Leave **anonymous sign-ins** switched off. Anonymous users count as signed-in users for every rule in this plan, so enabling them would let anyone read and write their own rows.
  - Optional, after your own account exists (Task 11): switch off new sign-ups in the project's Authentication settings (look for the "allow new users to sign up" switch; its exact place may differ), so nobody else can create accounts on your project.

- [ ] **Step 4: Write down the two public values**

  Read the project URL (`get_project_url`, or **Project Settings, API**) and the **publishable** key (`get_publishable_keys`, or the same page). Keep them for Task 11.
  
  Never copy the **secret** key or the old **service_role** key into this app, a `.env` file or Vercel. They bypass every rule in this plan. The app refuses to start the client if it finds one (Task 8).


### Task 2: Add the two dependencies and the environment typing
`@supabase/supabase-js` is the client. `@electric-sql/pglite` is an in-memory Postgres used only by tests, so the database rules can be tested on every `npm test` without a project. Both are pinned to exact versions. 2.118.0 of supabase-js was published on 15 Oct 2026; 2.119.0 came out two days before this plan was written, so it was skipped. The app reads its two public settings from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. If either is missing the app builds without a backend and runs signed out, as it does today. One consequence worth knowing: Vite replaces missing variables with `undefined` at build time, so the whole Supabase client is left out of the bundle until the variables are set. Once they are, it adds about 59 KB gzip (228 KB raw) and doubles the service worker precache from about 212 KiB to about 434 KiB. That was measured, and it is accepted here because Plan 3B needs auth, rows and file storage. Plan 3B should look at loading the client on demand, or at the smaller sub-packages without realtime.
**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `src/vite-env.d.ts`
- Create: `.env.example`

- [ ] **Step 1: Install the client at an exact version**

  Run:

```bash
npm install --save-exact --no-audit --no-fund @supabase/supabase-js@2.118.0
```

  Expected: `package.json` gains `"@supabase/supabase-js": "2.118.0"` under `dependencies`.

- [ ] **Step 2: Install the in-memory Postgres for tests at an exact version**

  Run:

```bash
npm install --save-dev --save-exact --no-audit --no-fund @electric-sql/pglite@0.5.14
```

  Expected: `package.json` gains `"@electric-sql/pglite": "0.5.14"` under `devDependencies`.

- [ ] **Step 3: Type the two public settings**

  In `src/vite-env.d.ts`, replace:

```ts
/// <reference types="vite-plugin-pwa/client" />
```

  with:

```ts
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** The Supabase project URL. Leave both unset to build the app without a backend. */
  readonly VITE_SUPABASE_URL?: string;
  /** The Supabase publishable key (starts with `sb_publishable_`). Never put a secret or service-role key here. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
```

- [ ] **Step 4: Document the two settings for whoever sets the project up**

  Create `.env.example`:

```sh
# Copy to .env.local for local development, and add the same two names under Settings -> Environment Variables in Vercel.
# Both are public: they are shipped to every browser. Use the PUBLISHABLE key only, never a secret or service-role key.
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

- [ ] **Step 5: Check that nothing else changed**

  Run:

```bash
npm run typecheck && npm test
```

  Expected: no type errors and `Tests  203 passed (203)`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/vite-env.d.ts .env.example
git commit -m "chore: add supabase-js and an in-memory Postgres for database tests"
```


### Task 3: The players table, with its security rules
One row per player per organizer. The rules are in the database, not the app: a signed-in organizer can read, add and change only their own rows, nobody can hard-delete, and `updated_at` is set by the server so a client cannot choose it. `updated_at` uses `clock_timestamp()` (the moment of the write), not `now()` (the start of the transaction): with `now()`, a long transaction stamps its rows with an old time and a sync that pulls by time can miss them (an independent review of this task found it). `photo_version` is the existing "changes on this device" count and can return to 0. The new `photo_seq` only ever goes up and names the storage file, so a removed and re-added photo never reuses a path (the final review of Plan 2 flagged the reuse problem; this is the fix, and Plan 3B adds the matching local field). The test harness gives an in-memory Postgres the parts of Supabase the migration leans on: the `anon`, `authenticated` and `service_role` roles, `auth.uid()`, the `storage` tables, and Supabase's broad default privileges, so the migration's own `revoke` is really tested. These are stand-ins, not Supabase itself, which is why Task 7 runs the same rules on the real project. Each rule was checked by breaking the migration on purpose: all 14 deliberate breakages across Tasks 3 to 5 were caught.
**Files:**
- Create: `src/sync/db/harness.ts`
- Create: `src/sync/db/players.test.ts`
- Create: `supabase/migrations/20261106120000_players.sql`

- [ ] **Step 1: Write the test harness**

  Create `src/sync/db/harness.ts`:

```ts
import { PGlite } from '@electric-sql/pglite';

/** Every migration in supabase/migrations, in file name order. */
const migrationFiles = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const USER_A = '00000000-0000-4000-8000-00000000000a';
export const USER_B = '00000000-0000-4000-8000-00000000000b';

/**
 * Stand-ins for the parts of Supabase the migrations lean on: the roles, `auth.uid()`, the `storage` tables,
 * and Supabase's broad default privileges (so the migrations' own `revoke` lines are really tested).
 * These mirror the real thing but are not the real thing: the plan also applies the migrations to a real project.
 */
const SUPABASE_STANDINS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end
  $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;
  grant execute on all functions in schema storage to anon, authenticated, service_role;

  grant usage on schema public to anon, authenticated, service_role;
`;

/**
 * Supabase has granted new tables and functions in `public` to anon, authenticated and service_role by default.
 * The docs say new projects are moving to opt-in grants, so the tests run both ways: with these defaults (the
 * old behaviour) and without them (the new one, where only the migrations' own explicit grants count).
 */
const SUPABASE_DEFAULT_GRANTS = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

/** A fresh in-memory Postgres with the stand-ins, every migration applied, and two users. */
export async function createDb(options: { defaultGrants?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STANDINS);
  if (options.defaultGrants !== false) await db.exec(SUPABASE_DEFAULT_GRANTS);
  for (const path of Object.keys(migrationFiles).sort()) {
    await db.exec(migrationFiles[path]);
  }
  await db.exec(`insert into auth.users (id) values ('${USER_A}'), ('${USER_B}')`);
  return db;
}

export type Caller = 'anon' | { user: string };

/** Runs one statement as a caller, in its own transaction, so a failed statement cannot poison the next. */
export async function run(db: PGlite, caller: Caller, sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    if (caller === 'anon') {
      await tx.query('set local role anon');
    } else {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: caller.user, role: 'authenticated' }),
      ]);
    }
    return tx.query(sql, params);
  });
}
```

- [ ] **Step 2: Write the failing tests**

  Create `src/sync/db/players.test.ts`:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run, type Caller } from './harness';

const ANN = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('truncate public.players');
});

/** Inserts a player as `caller`; `extra` adds numeric columns such as photo_version. */
function insertPlayer(caller: Caller, id: string, name: string, extra: Record<string, number> = {}) {
  const columns = ['id', 'name', ...Object.keys(extra)];
  const params = [id, name, ...Object.values(extra)];
  const marks = params.map((_, i) => `$${i + 1}`).join(', ');
  return run(db, caller, `insert into public.players (${columns.join(', ')}) values (${marks})`, params);
}

describe('players table', () => {
  it('fills in the owner from the signed-in user', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    const rows = (await run(db, { user: USER_A }, 'select owner_id, name, photo_version, photo_seq from public.players')).rows;
    expect(rows).toEqual([{ owner_id: USER_A, name: 'Ann', photo_version: 0, photo_seq: 0 }]);
  });

  it('turns away someone who is not signed in', async () => {
    await expect(insertPlayer('anon', ANN, 'Ann')).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', 'select * from public.players')).rejects.toThrow(/permission denied/i);
  });

  it('does not let an organizer write a row for someone else', async () => {
    await expect(
      run(db, { user: USER_A }, 'insert into public.players (owner_id, id, name) values ($1, $2, $3)', [USER_B, ANN, 'Ann']),
    ).rejects.toThrow(/row-level security/i);
  });

  it('shows each organizer only their own rows', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await insertPlayer({ user: USER_B }, BEN, 'Ben');
    const a = await run(db, { user: USER_A }, 'select name from public.players');
    const b = await run(db, { user: USER_B }, 'select name from public.players');
    expect(a.rows).toEqual([{ name: 'Ann' }]);
    expect(b.rows).toEqual([{ name: 'Ben' }]);
  });

  it('does not let an organizer change someone else\'s row', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    const result = await run(db, { user: USER_B }, "update public.players set name = 'Hacked' where id = $1", [ANN]);
    expect(result.affectedRows).toBe(0);
    const still = await db.query<{ name: string }>('select name from public.players where id = $1', [ANN]);
    expect(still.rows[0].name).toBe('Ann');
  });

  it('does not let an organizer hand their row to someone else, however the update is written', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    // With a WHERE on a column, the select policy also checks the new row. Without one, only the update policy does.
    const attempts: Array<[string, unknown[]]> = [
      ['update public.players set owner_id = $1 where id = $2', [USER_B, ANN]],
      ['update public.players set owner_id = $1', [USER_B]],
    ];
    for (const [sql, params] of attempts) {
      await expect(run(db, { user: USER_A }, sql, params)).rejects.toThrow(/row-level security/i);
    }
  });

  it('has no hard delete for organizers', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await expect(run(db, { user: USER_A }, 'delete from public.players where id = $1', [ANN])).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('keeps a player after a soft delete, so the deletion can sync', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await run(db, { user: USER_A }, 'update public.players set deleted_at = now() where id = $1', [ANN]);
    const rows = (await run(db, { user: USER_A }, 'select deleted_at is not null as deleted from public.players')).rows;
    expect(rows).toEqual([{ deleted: true }]);
  });

  it('sets updated_at from the server on insert and on every update, whatever the client sends', async () => {
    await run(db, { user: USER_A }, "insert into public.players (id, name, updated_at) values ($1, 'Ann', '2000-01-01')", [ANN]);
    const first = (await db.query<{ updated_at: Date }>('select updated_at from public.players')).rows[0].updated_at;
    expect(first.getFullYear()).toBeGreaterThan(2020);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await run(db, { user: USER_A }, "update public.players set name = 'Annie', updated_at = '2001-01-01' where id = $1", [ANN]);
    const second = (await db.query<{ updated_at: Date }>('select updated_at from public.players')).rows[0].updated_at;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(second.getFullYear()).toBeGreaterThan(2020);
  });

  it('stamps each row with the time it was written, even inside one long transaction', async () => {
    await db.transaction(async (tx) => {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_A, role: 'authenticated' })]);
      await tx.query("insert into public.players (id, name) values ($1, 'Ann')", [ANN]);
      await tx.query('select pg_sleep(0.05)');
      await tx.query("insert into public.players (id, name) values ($1, 'Ben')", [BEN]);
    });
    const { rows } = await db.query<{ name: string; updated_at: Date }>('select name, updated_at from public.players order by name');
    const [ann, ben] = rows;
    expect(ben.updated_at.getTime()).toBeGreaterThan(ann.updated_at.getTime());
  });

  it('keeps names unique per organizer, ignoring case and spaces, among players who are not deleted', async () => {
    await insertPlayer({ user: USER_A }, ANN, 'Ann');
    await expect(insertPlayer({ user: USER_A }, BEN, '  ANN ')).rejects.toThrow(/duplicate key/i);
    // another organizer may use the same name
    await insertPlayer({ user: USER_B }, BEN, 'Ann');
    // a deleted name can be used again
    await run(db, { user: USER_A }, 'update public.players set deleted_at = now() where id = $1', [ANN]);
    await insertPlayer({ user: USER_A }, CY, 'Ann');
  });

  it('rejects an empty name and a negative photo count', async () => {
    await expect(insertPlayer({ user: USER_A }, ANN, '   ')).rejects.toThrow(/check constraint/i);
    await expect(insertPlayer({ user: USER_A }, ANN, 'Ann', { photo_version: -1 })).rejects.toThrow(/check constraint/i);
    await expect(insertPlayer({ user: USER_A }, ANN, 'Ann', { photo_seq: -1 })).rejects.toThrow(/check constraint/i);
  });

  it('supports the upsert the sync will use (insert, then update on conflict)', async () => {
    const upsert = `insert into public.players (id, name, photo_version, photo_seq) values ($1, $2, $3, $4)
      on conflict (owner_id, id) do update set name = excluded.name, photo_version = excluded.photo_version, photo_seq = excluded.photo_seq`;
    await run(db, { user: USER_A }, upsert, [ANN, 'Ann', 0, 0]);
    await run(db, { user: USER_A }, upsert, [ANN, 'Annie', 1, 1]);
    const rows = (await run(db, { user: USER_A }, 'select name, photo_version, photo_seq from public.players')).rows;
    expect(rows).toEqual([{ name: 'Annie', photo_version: 1, photo_seq: 1 }]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail (the table does not exist yet)**

  Run:

```bash
npx vitest run src/sync/db/players.test.ts
```

  Expected: `Tests  13 failed (13)`, with `relation "public.players" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20261106120000_players.sql`:

```sql
-- Saved players: one row per player per organizer.
-- The device is the source of truth while playing; this table is the online backup (see the design spec,
-- "Sync and backend"). Deleting is soft (`deleted_at`) so a deletion can reach the organizer's other devices.

create table public.players (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  name text not null check (btrim(name) <> ''),
  -- 0 means no photo. It is a count of the photo's changes on that device and can return to 0.
  photo_version integer not null default 0 check (photo_version >= 0),
  -- Only ever goes up, and names the storage file, so a removed and re-added photo never reuses a path.
  photo_seq integer not null default 0 check (photo_seq >= 0),
  last_played_at timestamptz,
  deleted_at timestamptz,
  -- Set by a trigger on every write, so it is server time and a client cannot choose it.
  -- The trigger uses clock_timestamp() (the moment of the write), not now() (the start of the transaction),
  -- so a long transaction cannot stamp its rows with an old time that a pull by time would then skip.
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Names are unique per organizer, ignoring case and spaces, among players who are not deleted.
create unique index players_owner_name_key
  on public.players (owner_id, lower(btrim(name)))
  where deleted_at is null;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

-- A trigger function is never called as an API function.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger players_set_updated_at
  before insert or update on public.players
  for each row execute function public.set_updated_at();

alter table public.players enable row level security;

-- Each organizer sees and changes only their own rows. There is no delete policy:
-- deletes are soft, and a hard purge goes through public.delete_my_players().
create policy players_select_own on public.players
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy players_insert_own on public.players
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy players_update_own on public.players
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Supabase grants new tables to anon and authenticated by default. Take that back and grant only what is needed.
revoke all on public.players from anon, authenticated;
grant select, insert, update on public.players to authenticated;
```

- [ ] **Step 5: Run the tests and the type check**

  Run:

```bash
npx vitest run src/sync/db/players.test.ts && npm run typecheck
```

  Expected: `Tests  13 passed (13)`.

- [ ] **Step 6: Commit**

```bash
git add src/sync/db/harness.ts src/sync/db/players.test.ts supabase/migrations/20261106120000_players.sql
git commit -m "feat: players table with row-level security and a server-set updated_at"
```


### Task 4: The private photo bucket and its policies
Photos are personal data, so the bucket is private (no public URLs), takes only JPEG and is limited to 200 KB (a stored photo is about 15 to 40 KB). Files live at `{owner id}/{player id}/{photo_seq}.jpg`, and each policy lets an organizer touch only files whose first folder is their own id. Per the Supabase docs, upload needs an `INSERT` policy, overwriting also needs `SELECT` and `UPDATE`, and delete needs `DELETE`. The bucket is created from SQL (`insert into storage.buckets`), which the docs show. The `file_size_limit` and `allowed_mime_types` columns are used here too; the in-memory stand-in defines them, so only Task 7, on the real project, proves they exist.
**Files:**
- Create: `src/sync/db/photos.test.ts`
- Create: `supabase/migrations/20261106120100_player_photos.sql`

- [ ] **Step 1: Write the failing tests**

  Create `src/sync/db/photos.test.ts`:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('truncate storage.objects');
});

const put = (caller: Parameters<typeof run>[1], bucket: string, path: string) =>
  run(db, caller, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path]);
const names = async (caller: Parameters<typeof run>[1]) =>
  (await run(db, caller, 'select name from storage.objects order by name')).rows.map((r) => (r as { name: string }).name);

describe('player-photos bucket', () => {
  it('is private, small and JPEG only', async () => {
    const { rows } = await db.query('select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1', [
      'player-photos',
    ]);
    expect(rows).toEqual([{ public: false, file_size_limit: 204800, allowed_mime_types: ['image/jpeg'] }]);
  });

  it('lets an organizer add a file under their own id', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/player-1/1.jpg`);
    expect(await names({ user: USER_A })).toEqual([`${USER_A}/player-1/1.jpg`]);
  });

  it('does not let an organizer add a file under someone else\'s id, or outside any id folder', async () => {
    await expect(put({ user: USER_A }, 'player-photos', `${USER_B}/player-1/1.jpg`)).rejects.toThrow(/row-level security/i);
    await expect(put({ user: USER_A }, 'player-photos', 'loose.jpg')).rejects.toThrow(/row-level security/i);
  });

  it('does not let an organizer use the policies for a different bucket', async () => {
    await db.exec("insert into storage.buckets (id, name) values ('other', 'other')");
    await expect(put({ user: USER_A }, 'other', `${USER_A}/player-1/1.jpg`)).rejects.toThrow(/row-level security/i);
  });

  it('shows each organizer only their own files', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/p/1.jpg`);
    await put({ user: USER_B }, 'player-photos', `${USER_B}/p/1.jpg`);
    expect(await names({ user: USER_A })).toEqual([`${USER_A}/p/1.jpg`]);
    expect(await names({ user: USER_B })).toEqual([`${USER_B}/p/1.jpg`]);
  });

  it('lets an organizer replace and delete their own files, and no one else\'s', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/p/1.jpg`);
    await put({ user: USER_B }, 'player-photos', `${USER_B}/p/1.jpg`);

    const updateOwn = await run(db, { user: USER_A }, "update storage.objects set name = $1 where name = $2", [`${USER_A}/p/2.jpg`, `${USER_A}/p/1.jpg`]);
    expect(updateOwn.affectedRows).toBe(1);
    const updateOther = await run(db, { user: USER_A }, "update storage.objects set name = 'x' where name = $1", [`${USER_B}/p/1.jpg`]);
    expect(updateOther.affectedRows).toBe(0);
    await expect(
      run(db, { user: USER_A }, 'update storage.objects set name = $1 where name = $2', [`${USER_B}/stolen.jpg`, `${USER_A}/p/2.jpg`]),
    ).rejects.toThrow(/row-level security/i);

    const deleteOther = await run(db, { user: USER_A }, 'delete from storage.objects where name = $1', [`${USER_B}/p/1.jpg`]);
    expect(deleteOther.affectedRows).toBe(0);
    const deleteOwn = await run(db, { user: USER_A }, 'delete from storage.objects where name = $1', [`${USER_A}/p/2.jpg`]);
    expect(deleteOwn.affectedRows).toBe(1);
    expect(await names({ user: USER_B })).toEqual([`${USER_B}/p/1.jpg`]);
  });

  it('gives a signed-out visitor nothing', async () => {
    await put({ user: USER_A }, 'player-photos', `${USER_A}/p/1.jpg`);
    expect(await names('anon')).toEqual([]);
    await expect(put('anon', 'player-photos', `${USER_A}/p/2.jpg`)).rejects.toThrow(/row-level security/i);
  });
});
```

- [ ] **Step 2: Run them and watch them fail (no bucket, no policies)**

  Run:

```bash
npx vitest run src/sync/db/photos.test.ts
```

  Expected: `Tests  5 failed | 2 passed (7)`.

- [ ] **Step 3: Write the migration**

  Create `supabase/migrations/20261106120100_player_photos.sql`:

```sql
-- A private bucket for player photos. Each file lives at {owner id}/{player id}/{photo_seq}.jpg, and the
-- policies below let a signed-in organizer touch only the files under their own id.
-- Photos are personal data: the bucket is not public, so there are no public URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', false, 204800, array['image/jpeg'])
on conflict (id) do nothing;

create policy player_photos_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy player_photos_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Replacing a file (upsert) needs select and update as well as insert.
create policy player_photos_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy player_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'player-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
```

- [ ] **Step 4: Run the tests**

  Run:

```bash
npx vitest run src/sync/db/photos.test.ts
```

  Expected: `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
git add src/sync/db/photos.test.ts supabase/migrations/20261106120100_player_photos.sql
git commit -m "feat: private player-photos bucket with per-organizer storage policies"
```


### Task 5: The purge function for "Delete all my data"
Organizers have no delete policy on `players`, so a real delete needs a function. `delete_my_players()` deletes only the caller's rows, including soft-deleted ones, and returns how many. It runs with its owner's rights, so it is locked down the way the Supabase docs advise: an empty `search_path`, `EXECUTE` revoked from `public` and `anon`, and granted only to `authenticated`. Supabase's own security advisor has a lint for any `SECURITY DEFINER` function that signed-in users can run (lint 0029, named in the docs' notes on lint 0028); expect it to mention this function. That is intended here, and is why the function only ever touches the caller's rows. `grants.test.ts` exists because the Supabase docs say new projects are moving to opt-in grants: the other database tests run with the old "everything is granted by default" behaviour, which would hide a forgotten `grant`, so this file runs the same rules with those defaults switched off. The function does not touch photo files: the docs say storage files must be removed through the Storage API, never with SQL, or they are orphaned and still billed. The app does that in Plan 3B, in batches (the API removes up to 1000 files at a time).
**Files:**
- Create: `src/sync/db/purge.test.ts`
- Create: `src/sync/db/grants.test.ts`
- Create: `supabase/migrations/20261106120200_delete_my_players.sql`

- [ ] **Step 1: Write the failing tests**

  Create `src/sync/db/purge.test.ts`:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { USER_A, USER_B, createDb, run } from './harness';

const ANN = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CY = '33333333-3333-4333-8333-333333333333';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('truncate public.players');
});

const insert = (user: string, id: string, name: string) =>
  run(db, { user }, 'insert into public.players (id, name) values ($1, $2)', [id, name]);

describe('delete_my_players()', () => {
  it('deletes every one of the caller\'s rows, soft-deleted ones too, and returns how many', async () => {
    await insert(USER_A, ANN, 'Ann');
    await insert(USER_A, BEN, 'Ben');
    await run(db, { user: USER_A }, 'update public.players set deleted_at = now() where id = $1', [BEN]);

    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 2 }]);
    expect((await db.query('select count(*)::int as n from public.players')).rows).toEqual([{ n: 0 }]);
  });

  it('leaves other organizers\' rows alone', async () => {
    await insert(USER_A, ANN, 'Ann');
    await insert(USER_B, CY, 'Cy');
    await run(db, { user: USER_A }, 'select public.delete_my_players()');
    expect((await db.query('select name from public.players')).rows).toEqual([{ name: 'Cy' }]);
  });

  it('works when there is nothing to delete', async () => {
    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 0 }]);
  });

  it('cannot be called by someone who is not signed in', async () => {
    await expect(run(db, 'anon', 'select public.delete_my_players()')).rejects.toThrow(/permission denied/i);
  });

  it('pins an empty search path on both functions, so no one can hijack a name they look up', async () => {
    const { rows } = await db.query<{ proname: string; proconfig: string[] | null }>(
      `select proname, proconfig from pg_proc
       where pronamespace = 'public'::regnamespace and proname in ('delete_my_players', 'set_updated_at') order by proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual(['delete_my_players', 'set_updated_at']);
    for (const row of rows) expect(row.proconfig).toContain('search_path=""');
  });

  it('is not callable by default: only signed-in users hold execute', async () => {
    const { rows } = await db.query<{ grantee: string }>(
      `select distinct grantee from information_schema.routine_privileges
       where routine_schema = 'public' and routine_name = 'delete_my_players' and privilege_type = 'EXECUTE'
       order by grantee`,
    );
    const grantees = rows.map((r) => r.grantee);
    expect(grantees).toContain('authenticated');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('PUBLIC');
  });
});
```

- [ ] **Step 2: Run them and watch them fail (no function)**

  Run:

```bash
npx vitest run src/sync/db/purge.test.ts
```

  Expected: `Tests  6 failed (6)`.

- [ ] **Step 3: Write the migration**

  Create `supabase/migrations/20261106120200_delete_my_players.sql`:

```sql
-- "Delete all my data" needs a real delete, and organizers have no delete policy on players.
-- This function deletes only the caller's own rows. It runs with its owner's rights, so it is locked down:
-- no search path to hijack, and only signed-in users may call it.
-- (Photo files are not touched here: storage files must be removed through the Storage API, never with SQL.)

create function public.delete_my_players()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.players
    where owner_id = (select auth.uid())
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.delete_my_players() from public, anon;
grant execute on function public.delete_my_players() to authenticated;
```

- [ ] **Step 4: Run the tests**

  Run:

```bash
npx vitest run src/sync/db/purge.test.ts
```

  Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Pin the explicit grants: this test file builds the database without Supabase's default grants**

  Create `src/sync/db/grants.test.ts`:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USER_A, createDb, run } from './harness';

// New Supabase projects are moving to opt-in grants: nothing is granted to the API roles unless a migration says so.
// The other database tests run with the old broad defaults. These run without them, so only the migrations' own
// explicit grants count, and a forgotten `grant` shows up here.
let db: PGlite;
beforeAll(async () => {
  db = await createDb({ defaultGrants: false });
});
afterAll(async () => {
  await db.close();
});

describe('explicit grants (no default grants)', () => {
  it('lets a signed-in organizer read, add and change their own players', async () => {
    await run(db, { user: USER_A }, "insert into public.players (id, name) values ('11111111-1111-4111-8111-111111111111', 'Ann')");
    await run(db, { user: USER_A }, "update public.players set name = 'Annie'");
    const rows = (await run(db, { user: USER_A }, 'select name from public.players')).rows;
    expect(rows).toEqual([{ name: 'Annie' }]);
  });

  it('lets a signed-in organizer run the purge', async () => {
    const result = await run(db, { user: USER_A }, 'select public.delete_my_players() as removed');
    expect(result.rows).toEqual([{ removed: 1 }]);
  });

  it('still gives a signed-out visitor nothing', async () => {
    await expect(run(db, 'anon', 'select * from public.players')).rejects.toThrow(/permission denied/i);
    await expect(run(db, 'anon', 'select public.delete_my_players()')).rejects.toThrow(/permission denied/i);
  });

  it('gives no one the right to hard-delete', async () => {
    await expect(run(db, { user: USER_A }, 'delete from public.players')).rejects.toThrow(/permission denied/i);
  });
});
```

- [ ] **Step 6: Run it (it passes at once: it pins what the migrations already do, and was checked by deleting each grant)**

  Run:

```bash
npx vitest run src/sync/db/grants.test.ts
```

  Expected: `Tests  4 passed (4)`.

- [ ] **Step 7: Commit**

```bash
git add src/sync/db/purge.test.ts src/sync/db/grants.test.ts supabase/migrations/20261106120200_delete_my_players.sql
git commit -m "feat: delete_my_players() so an organizer can purge their own rows"
```


### Task 6: A check script you can run on the real project
The in-memory tests prove the rules against stand-ins. This script runs the same kind of checks on the real project (two test users, two organizers, one signed-out visitor, the purge, the private bucket). It runs inside one transaction that ends in `ROLLBACK`, so it leaves nothing behind (if it ever stops with an error, run `rollback;` before using that connection again). It also asserts the bucket is private, limited to 200 KB and accepts only `image/jpeg`. It is tested here too: it must pass on the migrations, leave no rows, and stop with a message when a rule is broken.
**Files:**
- Create: `supabase/tests/real-project-check.sql`
- Create: `src/sync/db/realProjectCheck.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `src/sync/db/realProjectCheck.test.ts`:

```ts
// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import script from '../../../supabase/tests/real-project-check.sql?raw';
import { createDb } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
});
afterAll(async () => {
  await db.close();
});

describe('supabase/tests/real-project-check.sql', () => {
  it('passes on the migrations and leaves nothing behind', async () => {
    await db.exec(script);
    expect((await db.query('select count(*)::int as n from public.players')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int as n from storage.objects')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int as n from auth.users where id in ($1, $2)', ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2'])).rows).toEqual([{ n: 0 }]);
  });

  it('stops with a message when a rule is broken', async () => {
    const broken = await createDb();
    await broken.exec('alter table public.players disable row level security');
    await expect(broken.exec(script)).rejects.toThrow(/can see Alice|changed Alice|wrote a player row/i);
    await broken.close();
  });
});
```

- [ ] **Step 2: Run it and watch it fail (the script does not exist)**

  Run:

```bash
npx vitest run src/sync/db/realProjectCheck.test.ts
```

  Expected: the run fails and no tests run, with `Error: Denied ID ../../../supabase/tests/real-project-check.sql?raw` (that is how this Vite version reports a missing file).

- [ ] **Step 3: Write the script**

  Create `supabase/tests/real-project-check.sql`:

```sql
-- Checks the security rules on a REAL Supabase project, after the three migrations are applied.
-- Run it in the SQL editor, or through the Supabase MCP `execute_sql`. It succeeds silently; a broken rule
-- stops it with a message. It runs in one transaction that ends in ROLLBACK, so it leaves nothing behind:
-- not the two test users, not the rows, not the photo entries.
-- If your project refuses the two test rows in auth.users, this check cannot run there: the rules are then
-- proven only by the in-memory tests, so say so rather than calling the real project checked.

begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2');

do $check$
declare
  alice constant uuid := '00000000-0000-4000-8000-0000000000a1';
  bob   constant uuid := '00000000-0000-4000-8000-0000000000b2';
  n integer;
begin
  -- Alice saves a player and a photo entry.
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.players (id, name) values ('00000000-0000-4000-8000-000000000001', 'Ann');
  insert into storage.objects (bucket_id, name)
    values ('player-photos', alice || '/00000000-0000-4000-8000-000000000001/1.jpg');
  reset role;

  -- Bob sees none of it, and cannot change it.
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.players;
  assert n = 0, 'Bob can see Alice''s players';
  select count(*) into n from storage.objects where bucket_id = 'player-photos';
  assert n = 0, 'Bob can see Alice''s photo files';

  update public.players set name = 'Hacked';
  get diagnostics n = row_count;
  assert n = 0, 'Bob changed Alice''s player';

  begin
    insert into public.players (owner_id, id, name) values (alice, '00000000-0000-4000-8000-000000000009', 'Fake');
    raise exception 'Bob wrote a player row for Alice';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('player-photos', alice || '/x/1.jpg');
    raise exception 'Bob wrote a file into Alice''s folder';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.players;
    raise exception 'Bob could hard-delete players';
  exception when insufficient_privilege then null;
  end;

  -- Bob's purge removes only Bob's own rows.
  insert into public.players (id, name) values ('00000000-0000-4000-8000-000000000002', 'Ben');
  select public.delete_my_players() into n;
  assert n = 1, 'The purge should delete exactly Bob''s one player';
  reset role;

  -- A signed-out visitor gets nothing.
  set local role anon;
  begin
    perform 1 from public.players;
    raise exception 'A signed-out visitor could read players';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_my_players();
    raise exception 'A signed-out visitor could run the purge';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- Alice's data survived Bob's purge, and the photo bucket is private and small.
  select count(*) into n from public.players where owner_id = alice;
  assert n = 1, 'Bob''s purge touched Alice''s players';
  select count(*) into n from storage.buckets
    where id = 'player-photos' and public = false and file_size_limit = 204800 and allowed_mime_types = array['image/jpeg'];
  assert n = 1, 'The player-photos bucket should be private, limited to 200 KB, and accept only image/jpeg';
end
$check$;

rollback;
```

- [ ] **Step 4: Run the test, the whole suite and the type check**

  Run:

```bash
npx vitest run src/sync/db/realProjectCheck.test.ts && npm test && npm run typecheck
```

  Expected: the new test passes (2 passed), then `Tests  235 passed (235)`.

- [ ] **Step 5: Commit**

```bash
git add src/sync/db/realProjectCheck.test.ts supabase/tests/real-project-check.sql
git commit -m "test: a rollback-only security check script for the real project"
```


### Task 7: Apply the migrations to the project and check them there
This is the first time the rules meet the real Supabase. It needs the project from Task 1, so it is not replayed. Do it before any sign-in work goes live: if a column or a policy behaves differently on the real project than on the stand-ins, this is where it shows.
**Files:**
- None in the repo. Supabase MCP tools or the dashboard SQL editor.

- [ ] **Step 1: Apply the three migrations, in file name order**

  Use the Supabase MCP tool `apply_migration` once per file, with the file's name (without `.sql`) and its exact SQL:
  
  1. `supabase/migrations/20261106120000_players.sql`
  2. `supabase/migrations/20261106120100_player_photos.sql`
  3. `supabase/migrations/20261106120200_delete_my_players.sql`
  
  Or paste each into the dashboard SQL editor. Then `list_migrations` should show all three, and `list_tables` should show `public.players` with row level security **enabled**.
  
  If migration 2 fails on `file_size_limit` or `allowed_mime_types`, those columns are named differently on the real project. Create the bucket in the dashboard instead (**Storage, New bucket**: name `player-photos`, **not** public, 200 KB limit, allowed type `image/jpeg`), remove the column list from the migration's `insert`, and re-run the in-memory tests.

- [ ] **Step 2: Run the real-project check**

  Run the whole of `supabase/tests/real-project-check.sql` with `execute_sql` (or the dashboard). Expected: it finishes without an error, and afterwards `select count(*) from public.players` is 0.
  
  If the project refuses the two test rows in `auth.users`, this check cannot run there. Then the rules are proven only by the in-memory tests: say so in your report and do not call Task 7 done.

- [ ] **Step 3: Read the security advisor**

  Run `get_advisors` with type `security`. Expect a finding for `public.delete_my_players`: a `SECURITY DEFINER` function that signed-in users can run (the docs call this lint 0029). That one is intended. The exact output was not available when this plan was written, so read every finding: anything about `public.players`, the bucket or the policies is new and needs reading before going on.

- [ ] **Step 4: Check the bucket settings**

  `execute_sql`: `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'player-photos';` Expected: `public` is `false`, `file_size_limit` is `204800`, `allowed_mime_types` is `{image/jpeg}`.


### Task 8: The Supabase client, with a guard against secret keys
`getSupabase()` returns the client, or `null` when no backend is configured, so everything else can treat "no backend" as a normal state. Everything in a `VITE_*` variable is shipped to every visitor, so a secret or service-role key put there by mistake would be public. The client therefore refuses a new-style `sb_secret_` key and an old-style JWT whose role is `service_role`, logs why, and behaves as if nothing were configured. It keeps the session on the device and does not look for one in the page address, because sign-in uses a typed code. It never throws: a malformed URL setting (a typo such as `x.supabase.co`) is caught, logged by setting name only (never the value), and treated as "no backend". Spaces around either setting are ignored, including around a secret key. An independent review probed this with the real client and found the throw.
**Files:**
- Create: `src/sync/client.ts`
- Create: `src/sync/client.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/sync/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const jwt = (role: string) => {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ role, iss: 'supabase' })}.signature`;
};

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('./client');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.doUnmock('@supabase/supabase-js');
});

describe('isSecretKey', () => {
  it('flags new-style secret keys and old-style service role keys', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('sb_secret_abc123')).toBe(true);
    expect(isSecretKey(jwt('service_role'))).toBe(true);
  });

  it('is not fooled by spaces around the key', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('  sb_secret_abc123 ')).toBe(true);
    expect(isSecretKey(` ${jwt('service_role')} `)).toBe(true);
  });

  it('accepts publishable keys and old-style anon keys', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('sb_publishable_abc123')).toBe(false);
    expect(isSecretKey(jwt('anon'))).toBe(false);
  });

  it('does not choke on text that is not a key', async () => {
    const { isSecretKey } = await load({});
    expect(isSecretKey('')).toBe(false);
    expect(isSecretKey('a.b.c')).toBe(false);
    expect(isSecretKey('not-a-key')).toBe(false);
  });
});

describe('getSupabase', () => {
  it('is null when nothing is configured, so the app runs without a backend', async () => {
    const { getSupabase } = await load({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getSupabase()).toBeNull();
  });

  it('is null when only one of the two is set', async () => {
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: '' });
    expect(getSupabase()).toBeNull();
  });

  it('refuses a secret key and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops' });
    expect(getSupabase()).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/secret key/i));
  });

  it('keeps the session on the device and does not look for one in the page address', async () => {
    const createClient = vi.fn(() => ({ auth: {} }));
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_abc123');
    const { getSupabase } = await import('./client');
    getSupabase();
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_abc123', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  });

  it('does not throw on a URL the client cannot use, and never prints the settings', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' });
    expect(getSupabase()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    const printed = String(error.mock.calls[0][0]);
    expect(printed).toMatch(/VITE_SUPABASE_URL/);
    expect(printed).not.toContain('not a url');
    expect(printed).not.toContain('sb_publishable_abc123');
  });

  it('ignores spaces around the two settings', async () => {
    const createClient = vi.fn(() => ({ auth: {} }));
    vi.resetModules();
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    vi.stubEnv('VITE_SUPABASE_URL', ' https://abc.supabase.co ');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', ' sb_publishable_abc123 ');
    const { getSupabase } = await import('./client');
    getSupabase();
    expect(createClient).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_abc123', expect.anything());
  });

  it('builds one client from a publishable key and reuses it', async () => {
    const { getSupabase } = await load({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123' });
    const first = getSupabase();
    expect(first).not.toBeNull();
    expect(typeof first!.auth.signInWithOtp).toBe('function');
    expect(getSupabase()).toBe(first);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

  Run:

```bash
npx vitest run src/sync/client.test.ts
```

  Expected: `Failed to resolve import "./client"`.

- [ ] **Step 3: Write the client**

  Create `src/sync/client.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * True for a key that must never reach a browser: a new-style secret key, or an old-style JWT whose role is
 * `service_role`. Everything in `VITE_*` is shipped to every visitor, so a secret key there would be public.
 */
export function isSecretKey(rawKey: string): boolean {
  const key = rawKey.trim();
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role === 'service_role';
  } catch {
    return false;
  }
}

let client: SupabaseClient | null | undefined;

/**
 * The Supabase client, or null when this build has no backend (no URL or key set, a secret key set by mistake,
 * or a URL the client cannot use). The app works fully without one, signed out. Never throws.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    client = null;
  } else if (isSecretKey(key)) {
    console.error('VITE_SUPABASE_PUBLISHABLE_KEY holds a secret key. Ignoring it: use the publishable key.');
    client = null;
  } else {
    try {
      // Sign-in uses a code typed into the app, not a link, so there is nothing to pick up from the page address.
      client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    } catch {
      // The message names the setting, never its value.
      console.error('Could not create the Supabase client. Check that VITE_SUPABASE_URL is the project address, like https://abc.supabase.co.');
      client = null;
    }
  }
  return client;
}
```

- [ ] **Step 4: Run the tests and the type check**

  Run:

```bash
npx vitest run src/sync/client.test.ts && npm run typecheck
```

  Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add src/sync/client.ts src/sync/client.test.ts
git commit -m "feat: supabase client that refuses secret keys and works without a backend"
```


### Task 9: The sign-in store
A small state machine: `unconfigured`, `loading`, `signedOut`, `codeSent`, `signedIn`. It sends the code (`signInWithOtp`), checks the six digits (`verifyOtp` with type `email`), signs out, and follows the session when it ends elsewhere. It checks the email and the six digits itself, so a typo never costs a request against the rate limit. Messages are plain words: a 429 becomes "Too many sign-in emails right now", and any other failure is a short sentence that does not repeat Supabase's wording. `createAuthStore(getClient)` takes the client as a parameter so tests use a fake; the app uses `useAuthStore`, built on `getSupabase`. `init()` is safe to call twice (React runs effects twice in development). An independent review ran the store against the real supabase-js with the network down and found the cases a fake hides, all fixed here and tested: (1) a saved session that needs refreshing while offline took about 25 seconds and then wrongly reported "signed out", so the store now waits at most 3 seconds and uses a sixth status, `unknown`, for "could not check" (neither signed in nor signed out; Plan 3B must neither sync nor clear in that state); (2) offline errors blamed the email address, so a failed request now says "No connection"; (3) with no connection the real client removes the session on the device and still returns an error, so sign-out no longer shows "Couldn't sign out" after it has signed out; (4) a rejected check, a throwing client or a double tap could leave the store stuck or spend a one-time code twice, so every action ignores a second call while one runs and always clears its busy flag. A background token refresh no longer wipes an unrelated message.
**Files:**
- Create: `src/sync/auth.ts`
- Create: `src/sync/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `src/sync/auth.test.ts`:

```ts
import type { AuthError, Session } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createAuthStore, type AuthClient } from './auth';

const session = (email: string) => ({ user: { email } }) as unknown as Session;
const failure = (status?: number) => ({ status, message: 'boom' }) as unknown as AuthError;

type Listener = (event: string, session: Session | null) => void;

function fakeClient(over: Partial<Record<keyof AuthClient, unknown>> = {}) {
  let listener: Listener | undefined;
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...over,
  };
  return { client: { auth: auth as unknown as AuthClient }, auth, emit: (e: string, s: Session | null) => listener?.(e, s) };
}

describe('auth store', () => {
  it('is "unconfigured" when the build has no backend, and never touches the network', async () => {
    const store = createAuthStore(() => null);
    await store.getState().init();
    expect(store.getState().status).toBe('unconfigured');
    await store.getState().sendCode('ann@example.com');
    expect(store.getState().status).toBe('unconfigured');
  });

  it('starts signed out when there is no saved session', async () => {
    const { client } = fakeClient();
    const store = createAuthStore(() => client);
    expect(store.getState().status).toBe('loading');
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
  });

  it('starts signed in when a session was saved on this device', async () => {
    const { client } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    expect(store.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com' });
  });

  it('only listens for session changes once, even if init is called twice', async () => {
    const { client, auth } = fakeClient();
    const store = createAuthStore(() => client);
    await Promise.all([store.getState().init(), store.getState().init()]);
    expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('follows the session when it ends elsewhere', async () => {
    const { client, emit } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    emit('SIGNED_OUT', null);
    expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
  });

  it('says "unknown", not "signed out", when a saved session cannot be checked', async () => {
    const { client } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    expect(store.getState().status).toBe('unknown');
  });

  it('does not wait for a session check that never finishes', async () => {
    const { client } = fakeClient({ getSession: vi.fn(() => new Promise(() => undefined)) });
    const store = createAuthStore(() => client, 10);
    await store.getState().init();
    expect(store.getState().status).toBe('unknown');
  });

  it('survives a session check that throws', async () => {
    const { client } = fakeClient({ getSession: vi.fn().mockRejectedValue(new Error('boom')) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    expect(store.getState().status).toBe('unknown');
  });

  it('moves on from "unknown" when the session turns out to be valid, or to be gone', async () => {
    const unchecked = () => fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });

    const valid = unchecked();
    const validStore = createAuthStore(() => valid.client);
    await validStore.getState().init();
    valid.emit('TOKEN_REFRESHED', session('ann@example.com'));
    expect(validStore.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com' });

    const gone = unchecked();
    const goneStore = createAuthStore(() => gone.client);
    await goneStore.getState().init();
    gone.emit('SIGNED_OUT', null);
    expect(goneStore.getState().status).toBe('signedOut');
  });

  it('keeps an unrelated message when the session is refreshed in the background', async () => {
    const { client, emit } = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const store = createAuthStore(() => client);
    await store.getState().init();
    store.setState({ error: 'Some message' });
    emit('TOKEN_REFRESHED', session('ann@example.com'));
    expect(store.getState().error).toBe('Some message');
  });

  describe('sending a code', () => {
    it('asks for the code and remembers the address', async () => {
      const { client, auth } = fakeClient();
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('  ann@example.com ');
      expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ann@example.com' });
      expect(store.getState()).toMatchObject({ status: 'codeSent', email: 'ann@example.com', error: null, busy: false });
    });

    it('rejects an address that is not an email without asking Supabase', async () => {
      const { client, auth } = fakeClient();
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann');
      expect(auth.signInWithOtp).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ status: 'signedOut', error: 'Enter a valid email address.' });
    });

    it('explains a rate limit in plain words', async () => {
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: failure(429) }) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      expect(store.getState().status).toBe('signedOut');
      expect(store.getState().error).toMatch(/too many sign-in emails/i);
      expect(store.getState().busy).toBe(false);
    });

    it('says there is no connection, instead of blaming the address', async () => {
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: failure(0) }) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      expect(store.getState().error).toBe('No connection. Try again when you are online.');
    });

    it('says there is no connection when the browser is offline and the request throws', async () => {
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      online.mockRestore();
      expect(store.getState()).toMatchObject({ busy: false, error: 'No connection. Try again when you are online.' });
    });

    it('ignores a second request while one is running', async () => {
      const { client, auth } = fakeClient();
      const store = createAuthStore(() => client);
      await store.getState().init();
      await Promise.all([store.getState().sendCode('ann@example.com'), store.getState().sendCode('ann@example.com')]);
      expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
    });

    it('shows a gentle message for any other failure, without Supabase\'s wording', async () => {
      const { client } = fakeClient({ signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: failure(500) }) });
      const store = createAuthStore(() => client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      expect(store.getState().error).toBe("Couldn't send the code. Check the address and try again.");
    });
  });

  describe('entering the code', () => {
    async function codeSent(over: Partial<Record<keyof AuthClient, unknown>> = {}) {
      const fake = fakeClient(over);
      const store = createAuthStore(() => fake.client);
      await store.getState().init();
      await store.getState().sendCode('ann@example.com');
      return { store, ...fake };
    }

    it('signs in with the six digits', async () => {
      const { store, auth } = await codeSent();
      await store.getState().verifyCode(' 123456 ');
      expect(auth.verifyOtp).toHaveBeenCalledWith({ email: 'ann@example.com', token: '123456', type: 'email' });
      expect(store.getState()).toMatchObject({ status: 'signedIn', email: 'ann@example.com', error: null });
    });

    it('rejects anything but six digits without asking Supabase', async () => {
      const { store, auth } = await codeSent();
      await store.getState().verifyCode('12345');
      await store.getState().verifyCode('12345a');
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({ status: 'codeSent', error: 'Enter the 6-digit code from the email.' });
    });

    it('tells the user a wrong or expired code did not work and keeps them on the code step', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(403) }) });
      await store.getState().verifyCode('000000');
      expect(store.getState().status).toBe('codeSent');
      expect(store.getState().error).toMatch(/did not work/i);
    });

    it('explains a rate limit', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(429) }) });
      await store.getState().verifyCode('000000');
      expect(store.getState().error).toMatch(/too many/i);
    });

    it('says there is no connection when checking the code', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });
      await store.getState().verifyCode('123456');
      expect(store.getState().status).toBe('codeSent');
      expect(store.getState().error).toBe('No connection. Try again when you are online.');
    });

    it('ignores a second submit while the first is running, so one good code is not spent twice', async () => {
      const { store, auth } = await codeSent();
      await Promise.all([store.getState().verifyCode('123456'), store.getState().verifyCode('123456')]);
      expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedIn', error: null });
    });

    it('is ready again after the client throws', async () => {
      const { store } = await codeSent({ verifyOtp: vi.fn().mockRejectedValue(new Error('boom')) });
      await store.getState().verifyCode('123456');
      expect(store.getState()).toMatchObject({ status: 'codeSent', busy: false });
      expect(store.getState().error).toMatch(/did not work/i);
    });

    it('lets the user go back and use a different email', async () => {
      const { store } = await codeSent();
      store.getState().changeEmail();
      expect(store.getState()).toMatchObject({ status: 'signedOut', error: null });
    });
  });

  describe('signing out', () => {
    async function signedIn(over: Partial<Record<keyof AuthClient, unknown>> = {}) {
      const fake = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }), ...over });
      const store = createAuthStore(() => fake.client);
      await store.getState().init();
      return { store, ...fake };
    }

    it('ignores a second sign-out while one is running', async () => {
      const { store, auth } = await signedIn();
      await Promise.all([store.getState().signOut(), store.getState().signOut()]);
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });

    it('signs out', async () => {
      const { store, auth } = await signedIn();
      await store.getState().signOut();
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'signedOut', email: null });
    });

    it('does not call it a failure when the session was removed on this device but the server could not be told', async () => {
      const listener: { emit?: (event: string, session: Session | null) => void } = {};
      const { store, emit } = await signedIn({
        signOut: vi.fn(async () => {
          listener.emit?.('SIGNED_OUT', null); // what supabase-js does as it removes the session on this device
          return { error: failure(0) };
        }),
      });
      listener.emit = emit;
      await store.getState().signOut();
      expect(store.getState()).toMatchObject({ status: 'signedOut', error: null, busy: false });
    });

    it('says so when it cannot sign out without a connection and nothing was removed', async () => {
      const { store } = await signedIn({ signOut: vi.fn().mockResolvedValue({ error: failure(0) }) });
      await store.getState().signOut();
      expect(store.getState().status).toBe('signedIn');
      expect(store.getState().error).toMatch(/without a connection/i);
    });

    it('stays signed in and says so when sign-out fails', async () => {
      const { store } = await signedIn({ signOut: vi.fn().mockResolvedValue({ error: failure(500) }) });
      await store.getState().signOut();
      expect(store.getState().status).toBe('signedIn');
      expect(store.getState().error).toBe("Couldn't sign out. Try again.");
    });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

  Run:

```bash
npx vitest run src/sync/auth.test.ts
```

  Expected: `Failed to resolve import "./auth"`.

- [ ] **Step 3: Write the store**

  Create `src/sync/auth.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { getSupabase } from './client';

/** The parts of Supabase Auth this app uses. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'verifyOtp' | 'signOut'
>;

/**
 * `unknown`: there may be a saved session, but it could not be checked (no connection). The app then says neither
 * "signed in" nor "signed out", and anything that syncs must neither sync nor clear.
 */
export type AuthStatus = 'unconfigured' | 'loading' | 'unknown' | 'signedOut' | 'codeSent' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  /** The signed-in email, or the address a code was sent to. */
  email: string | null;
  error: string | null;
  busy: boolean;
  init: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  /** Go back from "enter the code" to "enter your email". */
  changeEmail: () => void;
  signOut: () => Promise<void>;
}

const TOO_MANY = 'Too many sign-in emails right now. Wait a few minutes and try again.';
const OFFLINE = 'No connection. Try again when you are online.';

/** Checking a saved session that needs a refresh can take about 25 seconds with no connection; do not wait for it. */
const SESSION_CHECK_MS = 3000;

function isRateLimited(error: { status?: number }): boolean {
  return error.status === 429;
}

/** Status 0 is how supabase-js reports a request that never reached the server. */
function isOffline(error: { status?: number }): boolean {
  return error.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

/** A sign-in store over the given client. Pass a fake client (and a short check time) in tests. */
export function createAuthStore(getClient: () => { auth: AuthClient } | null, sessionCheckMs = SESSION_CHECK_MS) {
  let initialised = false;

  return create<AuthState>()((set, get) => {
    /** Runs one action: ignores a second call while one is running, and always clears `busy`, even if the client throws. */
    async function guarded(failure: string, work: () => Promise<void>) {
      if (get().busy) return;
      set({ busy: true, error: null });
      try {
        await work();
      } catch {
        set({ error: isOffline({}) ? OFFLINE : failure });
      } finally {
        set({ busy: false });
      }
    }

    return {
      status: 'loading',
      email: null,
      error: null,
      busy: false,

      async init() {
        if (initialised) return;
        initialised = true;
        const client = getClient();
        if (!client) {
          set({ status: 'unconfigured' });
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Keep the status in step with the session: sign-in, sign-out and a session that ended. The callback must
          // stay free of other Supabase calls.
          client.auth.onAuthStateChange((event, session) => {
            const email = session?.user.email;
            if (email) {
              if (get().status !== 'signedIn' || get().email !== email) set({ status: 'signedIn', email, error: null });
            } else if (event === 'SIGNED_OUT' && (get().status === 'signedIn' || get().status === 'unknown')) {
              set({ status: 'signedOut', email: null });
            }
          });
          const timeout = new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), sessionCheckMs);
          });
          const result = await Promise.race([client.auth.getSession(), timeout]);
          if (get().status !== 'loading') return; // the listener got there first
          if (result === 'timeout') {
            set({ status: 'unknown' });
          } else if (result.data.session?.user.email) {
            set({ status: 'signedIn', email: result.data.session.user.email });
          } else {
            // An error with no session means "could not check", not "nobody is signed in".
            set({ status: result.error ? 'unknown' : 'signedOut', email: null });
          }
        } catch {
          if (get().status === 'loading') set({ status: 'unknown' });
        } finally {
          clearTimeout(timer);
        }
      },

      async sendCode(rawEmail) {
        const client = getClient();
        if (!client || get().busy) return;
        const email = rawEmail.trim();
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          set({ error: 'Enter a valid email address.' });
          return;
        }
        const failure = "Couldn't send the code. Check the address and try again.";
        await guarded(failure, async () => {
          const { error } = await client.auth.signInWithOtp({ email });
          if (error) {
            set({ error: isRateLimited(error) ? TOO_MANY : isOffline(error) ? OFFLINE : failure });
            return;
          }
          set({ status: 'codeSent', email });
        });
      },

      async verifyCode(rawCode) {
        const client = getClient();
        const email = get().email;
        if (!client || !email || get().busy) return;
        const token = rawCode.trim();
        if (!/^\d{6}$/.test(token)) {
          set({ error: 'Enter the 6-digit code from the email.' });
          return;
        }
        const failure = 'That code did not work. Check it, or go back and ask for a new one.';
        await guarded(failure, async () => {
          const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
          if (error || !data.session) {
            set({ error: error && isRateLimited(error) ? TOO_MANY : error && isOffline(error) ? OFFLINE : failure });
            return;
          }
          set({ status: 'signedIn', email: data.session.user.email ?? email, error: null });
        });
      },

      changeEmail() {
        set({ status: 'signedOut', error: null });
      },

      async signOut() {
        const client = getClient();
        if (!client) return;
        await guarded("Couldn't sign out. Try again.", async () => {
          const { error } = await client.auth.signOut();
          // With no connection the client still removes the session on this device and tells the listener, which has
          // already moved us to signed out. Do not contradict that with an error.
          if (get().status === 'signedOut') return;
          if (error) {
            set({
              error: isOffline(error)
                ? "Can't sign out without a connection. Try again when you are online."
                : "Couldn't sign out. Try again.",
            });
            return;
          }
          set({ status: 'signedOut', email: null });
        });
      },
    };
  });
}

/** The app's sign-in store. */
export const useAuthStore = createAuthStore(getSupabase);
```

- [ ] **Step 4: Run the tests and the type check**

  Run:

```bash
npx vitest run src/sync/auth.test.ts && npm run typecheck
```

  Expected: `Tests  30 passed (30)`.

- [ ] **Step 5: Commit**

```bash
git add src/sync/auth.ts src/sync/auth.test.ts
git commit -m "feat: email-code sign-in store"
```


### Task 10: The Settings screen
Settings is reachable from Setup (a **Settings** button beside the title) and holds the account: the email form, the code form, who is signed in, and **Sign out**. When the build has no backend it says so in one sentence instead of showing a form that cannot work. The email form has `noValidate`, so a bad address gets this app's message instead of each browser's own tooltip (the jsdom test caught that the browser would otherwise swallow it). The Saved players header now shows "Signed in as ..." or "Signed out" (the spec puts sign-in state there; the sync status line joins it in Plan 3B). Setup stays mounted while Settings or Saved players is open, so a half-filled form survives the trip. The `unknown` state shows "Can't check sign-in without a connection. Your saved players are safe on this device." and no forms. The code field keeps only digits, so a code pasted as "123 456" works, and long emails wrap instead of overflowing a phone-width card. The tests go through the real `App` with a fake Supabase client, and each starts from fresh modules so the sign-in store is clean.
**Files:**
- Create: `src/ui/SettingsScreen.tsx`
- Create: `src/ui/settings.test.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/SetupScreen.tsx`
- Modify: `src/ui/SavedPlayersScreen.tsx`

- [ ] **Step 1: Write the failing tests (they go through the real `App`)**

  Create `src/ui/settings.test.tsx`:

```tsx
import type { AuthError, Session } from '@supabase/supabase-js';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app reads its Supabase client through getSupabase(); these tests hand it a fake one.
const backend = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../sync/client', () => ({ getSupabase: () => backend.client }));

const session = (email: string) => ({ user: { email } }) as unknown as Session;
const failure = (status: number) => ({ status, message: 'boom' }) as unknown as AuthError;

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      ...over,
    },
  };
}

/** A fresh copy of the app, so the sign-in store starts clean for every test. */
async function startApp(client: ReturnType<typeof fakeClient> | null) {
  vi.resetModules();
  backend.client = client;
  const { default: App } = await import('./App');
  render(<App />);
  return userEvent.setup();
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByRole('heading', { name: 'Settings' });
}

describe('Settings screen', () => {
  it('explains that sign-in is not set up when the build has no backend', async () => {
    const user = await startApp(null);
    await openSettings(user);
    expect(await screen.findByText(/sign-in is not set up/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('goes back to Setup without losing what was typed there', async () => {
    const user = await startApp(null);
    await user.type(screen.getByLabelText('Session name'), 'Friday open play');
    await openSettings(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Session name')).toHaveValue('Friday open play');
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('signs in with an emailed code, then signs out', async () => {
    const client = fakeClient();
    const user = await startApp(client);
    await openSettings(user);

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ann@example.com' });
    expect(await screen.findByText(/we sent a 6-digit code to/i)).toHaveTextContent('ann@example.com');

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ann@example.com', token: '123456', type: 'email' });
    expect(await screen.findByText(/signed in as/i)).toHaveTextContent('ann@example.com');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('shows a plain message when the code is wrong and stays on the code step', async () => {
    const client = fakeClient({ verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(403) }) });
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not work/i);
    expect(screen.getByLabelText('6-digit code')).toBeInTheDocument();
  });

  it('explains a rate limit and lets the user go back to change the email', async () => {
    const client = fakeClient({ signInWithOtp: vi.fn().mockResolvedValueOnce({ data: {}, error: failure(429) }).mockResolvedValue({ data: {}, error: null }) });
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many sign-in emails/i);

    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects an address that is not an email', async () => {
    const client = fakeClient();
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('says it cannot check sign-in offline, and shows no forms, when a saved session cannot be checked', async () => {
    const client = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: failure(0) }) });
    const user = await startApp(client);
    await openSettings(user);
    expect(await screen.findByText(/can't check sign-in without a connection/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('accepts a code pasted with a space in it', async () => {
    const client = fakeClient();
    const user = await startApp(client);
    await openSettings(user);
    await user.type(await screen.findByLabelText('Email'), 'ann@example.com');
    await user.click(screen.getByRole('button', { name: 'Send me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123 456');
    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ email: 'ann@example.com', token: '123456', type: 'email' });
  });

  it('starts signed in when this device already has a session', async () => {
    const client = fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) });
    const user = await startApp(client);
    await openSettings(user);
    expect(await screen.findByText(/signed in as/i)).toHaveTextContent('ann@example.com');
  });
});

describe('sign-in state on Saved players', () => {
  it('shows who is signed in, or that nobody is', async () => {
    const signedOut = await startApp(fakeClient());
    await signedOut.click(screen.getByRole('button', { name: 'Manage saved players' }));
    expect(await screen.findByText('Signed out')).toBeInTheDocument();
    cleanup();

    const user = await startApp(
      fakeClient({ getSession: vi.fn().mockResolvedValue({ data: { session: session('ann@example.com') }, error: null }) }),
    );
    await user.click(screen.getByRole('button', { name: 'Manage saved players' }));
    expect(await screen.findByText('Signed in as ann@example.com')).toBeInTheDocument();
  });

  it('shows nothing about sign-in when the build has no backend', async () => {
    const user = await startApp(null);
    await user.click(screen.getByRole('button', { name: 'Manage saved players' }));
    await screen.findByRole('heading', { name: 'Saved players' });
    expect(screen.queryByText(/signed (in|out)/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail (no Settings button yet)**

  Run:

```bash
npx vitest run src/ui/settings.test.tsx
```

  Expected: `Tests  10 failed | 1 passed (11)`, with `Unable to find an accessible element with the role "button" and name "Settings"`.

- [ ] **Step 3: Write the screen**

  Create `src/ui/SettingsScreen.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../sync/auth';

interface Props {
  onBack: () => void;
}

export function SettingsScreen({ onBack }: Props) {
  const { status, email, error, busy, sendCode, verifyCode, changeEmail, signOut } = useAuthStore();
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');

  function submitEmail(event: FormEvent) {
    event.preventDefault();
    void sendCode(emailInput);
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    void verifyCode(code);
  }

  return (
    <div className="stack">
      <div className="row-flex spread">
        <h1 className="screen-title">Settings</h1>
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
      </div>

      <section className="card stack" aria-labelledby="account-title">
        <h2 id="account-title" className="section-title">
          Account
        </h2>

        {status === 'unconfigured' && (
          <p className="muted">Sign-in is not set up in this version of the app. Your saved players stay on this device.</p>
        )}

        {status === 'loading' && (
          <p className="muted" role="status">
            Checking sign-in…
          </p>
        )}

        {status === 'unknown' && (
          <p className="muted" role="status">
            Can't check sign-in without a connection. Your saved players are safe on this device.
          </p>
        )}

        {/* noValidate on the email form: our own message for a bad address, instead of each browser's tooltip. */}
        {status === 'signedOut' && (
          <form className="stack" noValidate onSubmit={submitEmail}>
            <p className="muted">
              Sign in with your email. There is no password: we email you a 6-digit code. Backing up your saved players
              comes in a later update.
            </p>
            <label className="label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !emailInput.trim()}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        )}

        {status === 'codeSent' && (
          <form className="stack" onSubmit={submitCode}>
            <p>
              We sent a 6-digit code to <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong>. It can take a minute to arrive.
            </p>
            <label className="label" htmlFor="auth-code">
              6-digit code
            </label>
            <input
              id="auth-code"
              className="field"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              // Keep only the digits, so a code pasted as "123 456" or "123-456" still works.
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setCode('');
                changeEmail();
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {status === 'signedIn' && (
          <>
            <p>
              Signed in as <strong style={{ overflowWrap: 'anywhere' }}>{email}</strong>.
            </p>
            <button type="button" className="btn" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: `SetupScreen`: take an `onSettings` prop**

  In `src/ui/SetupScreen.tsx`, replace:

```tsx
interface Props {
  onManage: () => void;
}
```

  with:

```tsx
interface Props {
  onManage: () => void;
  onSettings: () => void;
}
```

- [ ] **Step 5: `SetupScreen`: use it**

  In `src/ui/SetupScreen.tsx`, replace:

```tsx
export function SetupScreen({ onManage }: Props) {
```

  with:

```tsx
export function SetupScreen({ onManage, onSettings }: Props) {
```

- [ ] **Step 6: `SetupScreen`: a Settings button beside the title**

  In `src/ui/SetupScreen.tsx`, replace:

```tsx
      <h1 className="screen-title">New session</h1>
```

  with:

```tsx
      <div className="row-flex spread">
        <h1 className="screen-title">New session</h1>
        <button type="button" className="btn btn-ghost btn-small" onClick={onSettings}>
          Settings
        </button>
      </div>
```

- [ ] **Step 7: `SavedPlayersScreen`: import the sign-in store**

  In `src/ui/SavedPlayersScreen.tsx`, replace:

```tsx
import { useRosterStore } from '../store/rosterStore';
```

  with:

```tsx
import { useAuthStore } from '../sync/auth';
import { useRosterStore } from '../store/rosterStore';
```

- [ ] **Step 8: `SavedPlayersScreen`: read the sign-in state**

  In `src/ui/SavedPlayersScreen.tsx`, replace:

```tsx
  const remove = useRosterStore((s) => s.remove);
```

  with:

```tsx
  const remove = useRosterStore((s) => s.remove);
  const authStatus = useAuthStore((s) => s.status);
  const authEmail = useAuthStore((s) => s.email);
```

- [ ] **Step 9: `SavedPlayersScreen`: show it under the header**

  In `src/ui/SavedPlayersScreen.tsx`, replace:

```tsx
          Back
        </button>
      </div>

      {error && (
```

  with:

```tsx
          Back
        </button>
      </div>

      {authStatus === 'signedIn' && (
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>
          Signed in as {authEmail}
        </p>
      )}
      {(authStatus === 'signedOut' || authStatus === 'codeSent') && <p className="muted">Signed out</p>}

      {error && (
```

- [ ] **Step 10: `App`: import the sign-in store**

  In `src/ui/App.tsx`, replace:

```tsx
import { useRosterStore } from '../store/rosterStore';
import { useUpdateStore } from '../pwa';
```

  with:

```tsx
import { useRosterStore } from '../store/rosterStore';
import { useAuthStore } from '../sync/auth';
import { useUpdateStore } from '../pwa';
```

- [ ] **Step 11: `App`: import the screen**

  In `src/ui/App.tsx`, replace:

```tsx
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SetupScreen } from './SetupScreen';
```

  with:

```tsx
import { SavedPlayersScreen } from './SavedPlayersScreen';
import { SettingsScreen } from './SettingsScreen';
import { SetupScreen } from './SetupScreen';
```

- [ ] **Step 12: `App`: three views instead of two, and the sign-in start function**

  In `src/ui/App.tsx`, replace:

```tsx
  const [managing, setManaging] = useState(false);
```

  with:

```tsx
  const initAuth = useAuthStore((s) => s.init);
  const [view, setView] = useState<'setup' | 'saved' | 'settings'>('setup');
```

- [ ] **Step 13: `App`: start the sign-in store when the app starts**

  In `src/ui/App.tsx`, replace:

```tsx
  }, [loadRoster]);
```

  with:

```tsx
  }, [loadRoster]);

  useEffect(() => {
    void initAuth();
  }, [initAuth]);
```

- [ ] **Step 14: `App`: show Setup, Saved players or Settings**

  In `src/ui/App.tsx`, replace:

```tsx
    // Setup stays mounted (just hidden) so a half-filled form survives a trip to Saved players.
    screen = (
      <>
        <div hidden={managing}>
          <SetupScreen onManage={() => setManaging(true)} />
        </div>
        {managing && <SavedPlayersScreen onBack={() => setManaging(false)} />}
      </>
    );
```

  with:

```tsx
    // Setup stays mounted (just hidden) so a half-filled form survives a trip to Saved players or Settings.
    screen = (
      <>
        <div hidden={view !== 'setup'}>
          <SetupScreen onManage={() => setView('saved')} onSettings={() => setView('settings')} />
        </div>
        {view === 'saved' && <SavedPlayersScreen onBack={() => setView('setup')} />}
        {view === 'settings' && <SettingsScreen onBack={() => setView('setup')} />}
      </>
    );
```

- [ ] **Step 15: Run the new tests, the whole suite, the type check and a build**

  Run:

```bash
npx vitest run src/ui/settings.test.tsx && npm test && npm run typecheck && npm run build
```

  Expected: 11 settings tests pass, then `Tests  287 passed (287)`, no type errors, and a successful build.

- [ ] **Step 16: Commit**

```bash
git add src/ui/SettingsScreen.tsx src/ui/settings.test.tsx src/ui/App.tsx src/ui/SetupScreen.tsx src/ui/SavedPlayersScreen.tsx
git commit -m "feat: settings screen with email-code sign-in and sign-out"
```


### Task 11: Turn it on: the two settings in Vercel, deploy, and check it live
Until the two environment variables exist, the deployed app has no Supabase code at all and behaves exactly as today. This task flips that. It needs the project (Tasks 1 and 7) and Vercel, so only the deploy note is replayed. Three Vercel projects are connected to this repo and each builds every push (found while merging Plan 2), and only one of them serves `piklmatch.vercel.app`. Set the variables on the one that does, and delete the other two while you are there.
**Files:**
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Update the deploy guide**

  In `docs/DEPLOY.md`, replace:

```md
- Supabase sync will need two environment variables (the project URL and the publishable key) added under **Settings → Environment Variables** in Vercel. The service-role key must never be added to the app.
```

  with:

```md
- Sign-in (and later sync) uses two environment variables, added under **Settings → Environment Variables** in Vercel: `VITE_SUPABASE_URL` (the project URL) and `VITE_SUPABASE_PUBLISHABLE_KEY` (the publishable key). Both are public: they are shipped to every browser. Never add a secret or service-role key; the app refuses to start the Supabase client if it finds one. Without them the app builds and runs signed out. Setting them adds about 59 KB gzip (228 KB raw) of Supabase code to the app, measured with supabase-js 2.118.0.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: describe the two Supabase settings in the deploy guide"
```

- [ ] **Step 3: Add the two settings in Vercel**

  In the Vercel project that serves `piklmatch.vercel.app`: **Settings, Environment Variables**. Add `VITE_SUPABASE_URL` (the project URL from Task 1) and `VITE_SUPABASE_PUBLISHABLE_KEY` (the **publishable** key). Apply them to Production (and Preview if you want previews to sign in). Re-check that the second value starts with `sb_publishable_`.
  
  While you are in Vercel, find the other two projects that build this repo and delete them: they cost build minutes and show up as three statuses on every push.

- [ ] **Step 4: Deploy and confirm the client is in the build**

  Merge to the production branch (or redeploy). Then:
  
  ```bash
  B=$(curl -s https://piklmatch.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
  curl -s "https://piklmatch.vercel.app/$B" | grep -c "rest/v1"
  ```
  
  Expected: a count above 0 (the Supabase client is now in the bundle). The bundle should be about 425 KB raw, up from about 197 KB.

- [ ] **Step 5: Sign in on the live site with your own address**

  Use an address that is a member of your Supabase organization (Task 1): the built-in email service sends only to team members. Open the live site, tap **Settings**, enter the address, tap **Send me a code**, then type the six digits. Expected: the screen changes to "Signed in as ...", and Saved players shows the same line.
  
  - Your **first** sign-in creates your account on the new project, so it is a brand-new user. After **Sign out**, your **second** sign-in is an existing user. Between them they cover both email templates from Task 1, so if either shows a link instead of a code, you know which template to fix.
  - Reload the page: you should still be signed in (the session is kept on the device).
  - If no code arrives: check spam, then the team-member and rate-limit notes in Task 1. An `email_address_not_authorized` error means the address is not a team member.

- [ ] **Step 6: Check that nothing is shared or synced yet**

  Nothing is synced until Plan 3B, so signing in must change nothing about the data. Check it:
  
  - In the Supabase dashboard (or `execute_sql`): `select count(*) from public.players;` Expected: **0**.
  - Run `get_advisors` with type `security` once more. Expected: the same findings as in Task 7, nothing new.
  - A second-account check in the browser needs a second address that is also a team member (or custom SMTP). If you do not have one, Task 7's `real-project-check.sql` is the proof that one organizer cannot see another's rows.

- [ ] **Step 7: Optional hardening**

  Once your own account exists, switch off new sign-ups in the project's Authentication settings (look for the "allow new users to sign up" switch). Sign-in still works for you; strangers can no longer create accounts on your project.


---

## Self-review

**Spec coverage** (section "Sync and backend (Supabase)"):

| Spec requirement | Where |
|---|---|
| Auth: email one-time code, six digits, no password | Tasks 1 (template), 9, 10 |
| The session persists on the device; signing out keeps the local roster | Tasks 8 (`persistSession`), 9 (sign-out touches no local data) |
| The app is fully usable signed out | Tasks 8 (`null` client), 9 (`unconfigured`), 10 (explains it) |
| A banner offers sign-in | **Plan 3B** (it only makes sense once there is something to back up) |
| Table `players` with owner, id, name, photo version, last played, deleted, server `updated_at`, primary key `(owner_id, id)`, unique name per owner where not deleted | Task 3 (plus `photo_seq`, decision 5) |
| Private bucket `player-photos`, path `{owner}/{player}/...` | Task 4 (the file name uses `photo_seq`) |
| Row-level security: select, insert and update only for the owner; storage only under the owner's folder; no delete policy on `players` | Tasks 3 and 4 |
| Only the project URL and the publishable key in the app; never the service-role key | Tasks 2, 8 (guard), 11 |
| Schema, policies and bucket as versioned SQL in `supabase/migrations/` | Tasks 3 to 5 |
| "Delete all my data" | Task 5 (the function); the screen and the file purge are **Plan 3B** |
| Database policy tests against the project or a local instance | Tasks 3 to 6 (in memory) and 7 (real project) |
| Free-tier notes (paused projects, limits to re-check) | Tasks 1 and 11 |
| The outbox, push and pull, conflicts, first sign-in merge, the sync status line | **Plan 3B** |

**Placeholder scan:** none. Every code step shows the exact text, and every manual step names the exact tool, setting or command.

**Type consistency:** `AuthClient` and `AuthState` (Task 9) are the only types the Settings screen and its tests use. `getSupabase` (Task 8) is the only name `auth.ts` imports from `client.ts`, and the Settings tests replace it by that name. `createDb`, `run`, `USER_A` and `USER_B` (Task 3) are used unchanged in Tasks 4 to 6. The SQL names `public.players`, `public.delete_my_players()` and the bucket `player-photos` are the same in the migrations, the tests and the real-project script.

## What Plan 3B will cover (not part of this plan)

Written after 3A ships. The decisions below carry over from the Plan 2 review notes so nothing is lost:

- **Local data:** IndexedDB version 3 with the `outbox` and `syncMeta` stores, an atomic `update(id, fn)` so a read-modify-write is one transaction (this also closes the cross-tab race), and a local `photoSeq` that matches `photo_seq`. Validate every pulled row before it reaches the screen.
- **Sync, from the independent review of the database tasks:** push **one row per request**, in outbox order. A unique-name clash (`23505`) fails a whole batch and cannot say which row clashed, so a batch with a rename swap, or a re-add before the matching soft delete, would never go through. On a clash, look up the clashing row by trimmed, lower-cased name, merge, then retry that one row. Pull with an **overlap**: ask for rows with `updated_at >= cursor - 2 minutes`, ordered by `(updated_at, id)`, and make the merge safe to repeat, because a transaction that started earlier can commit after the cursor moved past it. Normalise names the same way as the database before pushing: Postgres `btrim` strips only ordinary spaces while JavaScript `trim()` also strips tabs and no-break spaces. Upload photos with `contentType: 'image/jpeg'` and `upsert: false` (a path is never reused), and keep the owner id in the path in lower case.
- **Sync:** push the outbox in order (row, then photo, then the superseded file), pull rows newer than a cursor using the server `updated_at`, last write wins per player with a pending local change never overwritten, a same-name merge that keeps the server entry and adopts a missing photo, and the first-sign-in union by name.
- **Sign-in state:** treat `unknown` (a saved session that could not be checked offline) as "do not sync, do not clear". Start sync outside the sign-in listener, which must stay free of other Supabase calls.
- **UI:** the sync status line (Signed out, Synced, Syncing, Offline with N changes waiting, Can't reach server), the sign-in banner, and **Delete all my data** (remove the files through the Storage API in batches, call `delete_my_players()`, then clear the device).
- **Small follow-ups:** `navigator.storage.persist()`, a timeout and message for a blocked database upgrade, and loading the Supabase client on demand or from the smaller sub-packages to win back the size.
