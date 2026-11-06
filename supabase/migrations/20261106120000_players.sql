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
