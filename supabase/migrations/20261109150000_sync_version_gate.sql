-- Old installed clients must not overwrite revision rows or delete UUID photo files.
-- This is a compatibility gate, not an authorization boundary; owner RLS still applies.
create or replace function public.current_sync_client() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-pikl-sync-version', '') = '2';
$$;
revoke all on function public.current_sync_client() from public, anon;
grant execute on function public.current_sync_client() to authenticated;

drop policy if exists players_current_insert on public.players;
create policy players_current_insert on public.players as restrictive
  for insert to authenticated with check (public.current_sync_client());
drop policy if exists players_current_update on public.players;
create policy players_current_update on public.players as restrictive
  for update to authenticated using (public.current_sync_client()) with check (public.current_sync_client());
drop policy if exists photos_current_insert on storage.objects;
create policy photos_current_insert on storage.objects as restrictive
  for insert to authenticated with check (bucket_id <> 'player-photos' or public.current_sync_client());
drop policy if exists photos_current_update on storage.objects;
create policy photos_current_update on storage.objects as restrictive
  for update to authenticated using (bucket_id <> 'player-photos' or public.current_sync_client())
  with check (bucket_id <> 'player-photos' or public.current_sync_client());
drop policy if exists photos_current_delete on storage.objects;
create policy photos_current_delete on storage.objects as restrictive
  for delete to authenticated using (bucket_id <> 'player-photos' or public.current_sync_client());

-- The security-definer purge bypasses RLS, so gate it explicitly as well.
create or replace function public.delete_my_players() returns integer
language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if not public.current_sync_client() then
    raise exception 'Update the app before syncing or deleting account data';
  end if;
  delete from public.attendance_links where owner_id = (select auth.uid());
  delete from public.players where owner_id = (select auth.uid());
  get diagnostics removed = row_count;
  return removed;
end;
$$;
