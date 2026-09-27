-- Private photos are scoped to a household ID prefix in object names.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('the-list-photos','the-list-photos',false,10485760,
  array['image/jpeg','image/png','image/webp','image/gif']);

create policy the_list_photos_read on storage.objects
for select to authenticated using (
  bucket_id = 'the-list-photos' and exists (
    select 1 from public.household_members m
    where m.user_id = (select auth.uid())
      and m.household_id::text = split_part(name,'/',1)
  )
);

create policy the_list_photos_upload on storage.objects
for insert to authenticated with check (
  bucket_id = 'the-list-photos' and exists (
    select 1 from public.household_members m
    where m.user_id = (select auth.uid())
      and m.household_id::text = split_part(name,'/',1)
  )
);
