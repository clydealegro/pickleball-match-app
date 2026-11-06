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
