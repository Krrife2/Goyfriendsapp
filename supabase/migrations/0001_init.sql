-- Goyfriends schema
-- Message bodies and attachment bytes are end-to-end encrypted client-side before
-- they ever reach this database. Everything else in this file (names, avatars,
-- group titles/photos, reactions, timestamps) is ordinary server-visible metadata.

create extension if not exists pgcrypto;

-- ===== profiles =====
-- One row per invited user, created client-side on first login after the
-- Supabase auth.users row already exists (via magic-link invite).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_path text,                 -- path in the 'avatars' storage bucket
  public_key text not null,         -- base64 X25519 public key; NOT secret, published for key-wrapping
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== conversations =====
create table conversations (
  id uuid primary key default gen_random_uuid(),
  title text,                       -- nullable; client falls back to member names if unset
  is_group boolean not null default true,
  photo_path text,                  -- path in the 'avatars' bucket (group photo)
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== conversation_members =====
create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ===== conversation_keys =====
-- One row per (conversation, member): that conversation's random symmetric key,
-- individually sealed (crypto_box_seal) to the member's public key client-side.
-- The server only ever stores ciphertext of the key itself.
create table conversation_keys (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  wrapped_key text not null,        -- base64 crypto_box_seal(sym_key, member_public_key)
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ===== messages =====
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender uuid not null references profiles(id),
  ciphertext text not null,                -- base64 secretbox ciphertext of the message body
  nonce text not null,                     -- base64 nonce used for this message
  reply_to uuid references messages(id),
  attachment_path text,                     -- path in the 'attachments' bucket (ciphertext blob)
  attachment_name_ciphertext text,          -- filename, encrypted (avoids leaking it via metadata)
  attachment_name_nonce text,
  attachment_size bigint,                   -- size is visible from the blob regardless; not an extra leak
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on messages (conversation_id, created_at);

-- ===== message_reactions =====
-- Own table rather than a jsonb column on messages: two people tapback-reacting
-- at the same moment would otherwise race on a read-modify-write of one jsonb blob
-- and silently drop one reaction. Plaintext metadata, like reactions in any messenger.
create table message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
