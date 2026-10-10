-- Private project attachments use the same household ownership model as photos.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('the-list-files','the-list-files',false,10485760,
 array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/json','text/plain','text/markdown','text/csv']);

create policy the_list_files_read on storage.objects
for select to authenticated using (
 bucket_id = 'the-list-files' and exists (
  select 1 from public.household_members m
  where m.user_id = (select auth.uid())
    and m.household_id::text = split_part(name,'/',1)
 )
);
create policy the_list_files_upload on storage.objects
for insert to authenticated with check (
 bucket_id = 'the-list-files' and exists (
  select 1 from public.household_members m
  where m.user_id = (select auth.uid())
    and m.household_id::text = split_part(name,'/',1)
 )
);
