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
