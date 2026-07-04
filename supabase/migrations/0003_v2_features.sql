-- v2 feature additions: pin/mute, edit/unsend, read receipts, push notifications

-- ===== conversation_members: pin + mute =====
alter table conversation_members add column pinned_at timestamptz;
alter table conversation_members add column muted boolean not null default false;
-- Pin/mute are personal to each member — you may only update your own row.
create policy conv_members_update_own on conversation_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===== messages: edit + unsend =====
alter table messages add column edited_at timestamptz;
alter table messages add column deleted_at timestamptz;
-- Sender can edit/unsend their own messages (re-encrypt content, or set
-- deleted_at — ciphertext stays not-null but is simply never rendered once
-- deleted_at is set; see db/messages.js unsendMessage).
create policy messages_update_own on messages
  for update using (sender = auth.uid());
grant update on messages to authenticated;

-- ===== profiles: read receipts opt-in, default OFF =====
alter table profiles add column read_receipts_enabled boolean not null default false;

-- ===== message_reads (opt-in read receipts) =====
create table message_reads (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table message_reads enable row level security;
create policy message_reads_select_member on message_reads
  for select using (
    exists (select 1 from messages m where m.id = message_id and is_conv_member(m.conversation_id))
  );
create policy message_reads_insert_own on message_reads
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from messages m where m.id = message_id and is_conv_member(m.conversation_id))
  );
grant select, insert on message_reads to authenticated;

-- ===== push_subscriptions =====
-- One row per browser/device subscription. Users manage only their own.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy push_subs_select_own on push_subscriptions
  for select using (user_id = auth.uid());
create policy push_subs_insert_own on push_subscriptions
  for insert with check (user_id = auth.uid());
create policy push_subs_delete_own on push_subscriptions
  for delete using (user_id = auth.uid());
grant select, insert, delete on push_subscriptions to authenticated;

-- ===== push notification trigger =====
-- On every new message, notify the notify-message Edge Function (deployed
-- separately, see supabase/functions/notify-message), which sends generic
-- Web Push previews (sender name + conversation title only — it never has
-- the E2E key, so it can never include message content).
create extension if not exists pg_net;

-- Generate fresh random values for these two secrets when re-running this
-- migration on a new project — do not reuse the ones from another project.
select vault.create_secret(
  'wh_' || encode(gen_random_bytes(24), 'hex'),
  'goyfriends_webhook_secret',
  'Shared secret between the messages insert trigger and the notify-message Edge Function'
);
-- vapid_private_key must be created separately with your own generated VAPID
-- keypair (see README "Push notifications" section):
--   select vault.create_secret('<your VAPID private key>', 'vapid_private_key', '...');

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_project_url text := 'https://xdtehgvbmtpvqcecaiaq.supabase.co'; -- update if forking to a new project
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'goyfriends_webhook_secret';

  perform net.http_post(
    url := v_project_url || '/functions/v1/notify-message',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'message_id', new.id,
      'conversation_id', new.conversation_id,
      'sender', new.sender
    )
  );
  return new;
end;
$$;

create trigger on_message_insert_notify
  after insert on messages
  for each row execute function public.notify_new_message();

-- vault.decrypted_secrets isn't exposed through PostgREST (only `public` is)
-- — this narrow RPC wraps just the two secrets the Edge Function needs,
-- grantable only to service_role, never reachable by anon or authenticated.
create or replace function public.get_webhook_secrets()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'goyfriends_webhook_secret'),
    'vapid_private_key', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key')
  );
$$;

revoke all on function public.get_webhook_secrets() from public, anon, authenticated;
grant execute on function public.get_webhook_secrets() to service_role;
