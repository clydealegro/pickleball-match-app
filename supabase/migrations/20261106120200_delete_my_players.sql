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
