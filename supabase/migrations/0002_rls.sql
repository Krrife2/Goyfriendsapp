-- Goyfriends RLS
-- Message content is already ciphertext by the time it reaches these tables, but
-- RLS is still enforced everywhere as defense in depth and to protect metadata
-- (who's in which conversation, who sent what, when) from anyone but members.

alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table conversation_keys enable row level security;
alter table messages enable row level security;
alter table message_reactions enable row level security;

-- ===== is_conv_member() =====
create or replace function is_conv_member(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from conversation_members
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;

-- ===== profiles =====
-- Any invited (authenticated) user can see everyone's name/avatar/public_key —
-- needed to render member lists and to wrap conversation keys to new members.
create policy profiles_select_all on profiles
  for select using (auth.uid() is not null);
create policy profiles_insert_self on profiles
  for insert with check (id = auth.uid());
create policy profiles_update_self on profiles
  for update using (id = auth.uid());

-- ===== conversations =====
create policy conversations_select_member on conversations
  for select using (is_conv_member(id));
create policy conversations_insert_creator on conversations
  for insert with check (auth.uid() is not null and created_by = auth.uid());
-- Any member can rename or change the group photo, mirroring iMessage's default behavior.
create policy conversations_update_member on conversations
  for update using (is_conv_member(id));

-- ===== conversation_members =====
create policy conv_members_select_member on conversation_members
  for select using (is_conv_member(conversation_id));
-- Allow the creator to seed the initial member list, and existing members to add
-- others later (e.g. inviting a new friend into an existing group).
create policy conv_members_insert_creator_or_member on conversation_members
  for insert with check (
    exists (select 1 from conversations c where c.id = conversation_id and c.created_by = auth.uid())
    or is_conv_member(conversation_id)
  );
create policy conv_members_delete_self on conversation_members
  for delete using (user_id = auth.uid());

-- ===== conversation_keys =====
-- Critical policy: a user may ONLY ever read their own wrapped key row, never
-- anyone else's. This is what keeps the symmetric key confidential per-member.
create policy conv_keys_select_own on conversation_keys
  for select using (user_id = auth.uid());
create policy conv_keys_insert_creator_or_member on conversation_keys
  for insert with check (
    exists (select 1 from conversations c where c.id = conversation_id and c.created_by = auth.uid())
    or is_conv_member(conversation_id)
  );

-- ===== messages =====
create policy messages_select_member on messages
  for select using (is_conv_member(conversation_id));
create policy messages_insert_member on messages
  for insert with check (is_conv_member(conversation_id) and sender = auth.uid());

-- ===== message_reactions =====
create policy reactions_select_member on message_reactions
  for select using (
    exists (select 1 from messages m where m.id = message_id and is_conv_member(m.conversation_id))
  );
create policy reactions_insert_own on message_reactions
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from messages m where m.id = message_id and is_conv_member(m.conversation_id))
  );
create policy reactions_delete_own on message_reactions
  for delete using (user_id = auth.uid());

-- ===== explicit grants =====
-- Needed if "Automatically expose new tables" was left off when creating the
-- project (Supabase's own recommended default) — a GRANT is what lets the
-- `authenticated` role attempt these operations at all; RLS policies above
-- then filter which rows they can actually see/touch. Deliberately nothing
-- granted to `anon` — this app has no unauthenticated features, so there's
-- no reason for that role to be able to touch these tables at all.
grant usage on schema public to authenticated;
grant select, insert, update on profiles to authenticated;
grant select, insert, update on conversations to authenticated;
grant select, insert, delete on conversation_members to authenticated;
grant select, insert on conversation_keys to authenticated;
grant select, insert on messages to authenticated;
grant select, insert, delete on message_reactions to authenticated;

-- Postgres grants EXECUTE to PUBLIC by default on function creation, which
-- makes is_conv_member callable directly via /rest/v1/rpc/is_conv_member by
-- anyone, signed in or not — not needed, since it's only ever meant to be
-- evaluated internally by the policies above. Revoke from PUBLIC, then
-- re-grant only to `authenticated`, since policy evaluation for that role
-- requires EXECUTE on any function a policy calls (anon has no grants on
-- these tables at all, so it never needs to evaluate this function anyway).
-- A residual "authenticated can call this via RPC" advisor warning is
-- expected and fine to leave — all it discloses is "am I a member of
-- conversation X" for a UUID the caller would already have to know.
revoke execute on function public.is_conv_member(uuid) from public;
grant execute on function public.is_conv_member(uuid) to authenticated;
revoke execute on function public.rls_auto_enable() from public;

-- ===== storage: avatars bucket (profile photos + group photos) =====
-- Authenticated-read (private friend group, not public internet), write restricted
-- to the owner's own path prefix or, for group photos, any member of that group.
-- Path convention: avatars/user/{user_id}/... and avatars/conversation/{conversation_id}/...
create policy avatars_read_authenticated on storage.objects
  for select using (bucket_id = 'avatars' and auth.uid() is not null);

create policy avatars_write_own_or_group on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = 'user' and (storage.foldername(name))[2] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'conversation'
        and is_conv_member((storage.foldername(name))[2]::uuid)
      )
    )
  );

create policy avatars_update_own_or_group on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = 'user' and (storage.foldername(name))[2] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'conversation'
        and is_conv_member((storage.foldername(name))[2]::uuid)
      )
    )
  );

-- ===== storage: attachments bucket (encrypted files) =====
-- Path convention: attachments/{conversation_id}/{message_id}
create policy attachments_read_member on storage.objects
  for select using (
    bucket_id = 'attachments'
    and is_conv_member((storage.foldername(name))[1]::uuid)
  );

create policy attachments_write_member on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and is_conv_member((storage.foldername(name))[1]::uuid)
  );
